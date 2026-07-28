import { IText } from '../shapes/IText/IText';
import { invertTransform } from '../util/misc/matrix';
import {
  createVisualLineLayout,
  mergeVisualIntervals,
  type VisualCaret,
  type VisualLineLayout,
} from './rtlVisualLayout';

type EditableText = IText & Record<string, any>;

type CaretState = {
  globalIndex: number;
  lineIndex: number;
  displayIndex: number;
  visualX: number;
  affinity: 'before' | 'after';
};

const layoutCache = new WeakMap<object, Map<number, { hash: string; layout: VisualLineLayout }>>();
let installed = false;

const getOriginalLineLength = (target: EditableText, lineIndex: number): number =>
  typeof target._getOriginalLineLength === 'function'
    ? target._getOriginalLineLength(lineIndex)
    : target._textLines[lineIndex]?.length || 0;

const displayToOriginal = (
  target: EditableText,
  lineIndex: number,
  displayIndex: number,
): number =>
  typeof target._displayToOriginalIndex === 'function'
    ? target._displayToOriginalIndex(lineIndex, displayIndex)
    : displayIndex;

const originalToDisplay = (
  target: EditableText,
  lineIndex: number,
  originalIndex: number,
): number =>
  typeof target._originalToDisplayIndex === 'function'
    ? target._originalToDisplayIndex(lineIndex, originalIndex)
    : originalIndex;

const getLineStart = (target: EditableText, lineIndex: number): number => {
  let start = 0;
  for (let index = 0; index < lineIndex; index++) {
    start += getOriginalLineLength(target, index) + target.missingNewlineOffset(index);
  }
  return start;
};

const getLineLocation = (
  target: EditableText,
  globalIndex: number,
): { lineIndex: number; originalIndex: number; lineStart: number } => {
  const clamped = Math.max(0, globalIndex);
  let lineStart = 0;

  for (let lineIndex = 0; lineIndex < target._textLines.length; lineIndex++) {
    const lineLength = getOriginalLineLength(target, lineIndex);
    if (clamped <= lineStart + lineLength || lineIndex === target._textLines.length - 1) {
      return {
        lineIndex,
        originalIndex: Math.max(0, Math.min(lineLength, clamped - lineStart)),
        lineStart,
      };
    }
    lineStart += lineLength + target.missingNewlineOffset(lineIndex);
  }

  return { lineIndex: 0, originalIndex: 0, lineStart: 0 };
};

const getLineFromY = (target: EditableText, yFromTop: number): number => {
  let top = 0;
  for (let index = 0; index < target._textLines.length; index++) {
    const height = target.getHeightOfLine(index);
    if (yFromTop < top + height || index === target._textLines.length - 1) {
      return index;
    }
    top += height;
  }
  return Math.max(0, target._textLines.length - 1);
};

const getLineTop = (target: EditableText, lineIndex: number): number => {
  let top = 0;
  for (let index = 0; index < lineIndex; index++) {
    top += target.getHeightOfLine(index);
  }
  return top;
};

const getAlignmentOffset = (target: EditableText, lineIndex: number): number => {
  const lineWidth = target.getLineWidth(lineIndex);
  if (target.textAlign === 'center' || target.textAlign === 'justify-center') {
    return (target.width - lineWidth) / 2;
  }
  if (target.textAlign === 'right' || target.textAlign === 'justify-right') {
    return target.width - lineWidth;
  }
  if (
    target.direction === 'rtl' &&
    (target.textAlign === 'left' || target.textAlign === 'justify')
  ) {
    return target.width - lineWidth;
  }
  return 0;
};

const getLayout = (target: EditableText, lineIndex: number): VisualLineLayout => {
  const line = target._textLines[lineIndex] || [];
  // Ensure __charBounds has been populated lazily by Fabric.
  target._getLineLeftOffset(lineIndex);
  const bounds = target.__charBounds[lineIndex] || [];
  const widths = line.map((_: string, index: number) => bounds[index]?.kernedWidth || 0);
  const hash = `${target.direction}|${line.join('')}|${widths.join(',')}`;
  let targetCache = layoutCache.get(target);
  if (!targetCache) {
    targetCache = new Map();
    layoutCache.set(target, targetCache);
  }
  const cached = targetCache.get(lineIndex);
  if (cached?.hash === hash) {
    return cached.layout;
  }
  const layout = createVisualLineLayout(
    line,
    widths,
    target.direction === 'rtl' ? 'rtl' : 'ltr',
  );
  targetCache.set(lineIndex, { hash, layout });
  return layout;
};

const getCaretCandidates = (
  layout: VisualLineLayout,
  displayIndex: number,
): VisualCaret[] => layout.carets.filter((caret) => caret.displayIndex === displayIndex);

const chooseCaret = (
  target: EditableText,
  globalIndex: number,
  lineIndex: number,
  originalIndex: number,
  layout: VisualLineLayout,
): VisualCaret => {
  const displayIndex = originalToDisplay(target, lineIndex, originalIndex);
  const candidates = getCaretCandidates(layout, displayIndex);
  const state = target.__nativeRtlCaretState as CaretState | undefined;

  if (state?.globalIndex === globalIndex && state.lineIndex === lineIndex) {
    const exact = candidates.find(
      (caret) =>
        caret.affinity === state.affinity &&
        Math.abs(caret.visualX - state.visualX) < 0.75,
    );
    if (exact) {
      return exact;
    }
  }

  if (candidates.length > 0) {
    if (originalIndex === 0) {
      return target.direction === 'rtl'
        ? candidates.reduce((best, caret) => (caret.visualX > best.visualX ? caret : best))
        : candidates.reduce((best, caret) => (caret.visualX < best.visualX ? caret : best));
    }
    if (originalIndex >= getOriginalLineLength(target, lineIndex)) {
      return target.direction === 'rtl'
        ? candidates.reduce((best, caret) => (caret.visualX < best.visualX ? caret : best))
        : candidates.reduce((best, caret) => (caret.visualX > best.visualX ? caret : best));
    }
    return candidates.find((caret) => caret.affinity === 'before') || candidates[0];
  }

  return {
    displayIndex,
    visualX: target.direction === 'rtl' ? 0 : layout.width,
    affinity: 'before',
    clusterDisplayIndex: Math.max(0, displayIndex - 1),
  };
};

const rememberCaret = (
  target: EditableText,
  globalIndex: number,
  lineIndex: number,
  caret: VisualCaret,
) => {
  target.__nativeRtlCaretState = {
    globalIndex,
    lineIndex,
    displayIndex: caret.displayIndex,
    visualX: caret.visualX,
    affinity: caret.affinity,
  } satisfies CaretState;
};

const nearestCaret = (layout: VisualLineLayout, x: number): VisualCaret => {
  let nearest = layout.carets[0] || {
    displayIndex: 0,
    visualX: 0,
    affinity: 'before' as const,
    clusterDisplayIndex: 0,
  };
  let distance = Math.abs(x - nearest.visualX);
  for (let index = 1; index < layout.carets.length; index++) {
    const candidate = layout.carets[index];
    const candidateDistance = Math.abs(x - candidate.visualX);
    if (candidateDistance < distance) {
      nearest = candidate;
      distance = candidateDistance;
    }
  }
  return nearest;
};

const setCollapsedSelection = (
  target: EditableText,
  globalIndex: number,
  lineIndex: number,
  caret: VisualCaret,
) => {
  target.selectionStart = globalIndex;
  target.selectionEnd = globalIndex;
  rememberCaret(target, globalIndex, lineIndex, caret);
};

const moveVisualCaret = (
  target: EditableText,
  direction: -1 | 1,
  event: KeyboardEvent,
): boolean => {
  if (event.altKey || event.metaKey || event.ctrlKey || event.keyCode === 35 || event.keyCode === 36) {
    return false;
  }

  if (target.selectionStart !== target.selectionEnd && !event.shiftKey) {
    const start = getLineLocation(target, target.selectionStart);
    const end = getLineLocation(target, target.selectionEnd);
    if (start.lineIndex !== end.lineIndex) {
      const index = direction < 0 ? target.selectionStart : target.selectionEnd;
      const location = getLineLocation(target, index);
      const layout = getLayout(target, location.lineIndex);
      const caret = chooseCaret(
        target,
        index,
        location.lineIndex,
        location.originalIndex,
        layout,
      );
      setCollapsedSelection(target, index, location.lineIndex, caret);
      return true;
    }

    const layout = getLayout(target, start.lineIndex);
    const startCaret = chooseCaret(
      target,
      target.selectionStart,
      start.lineIndex,
      start.originalIndex,
      layout,
    );
    const endCaret = chooseCaret(
      target,
      target.selectionEnd,
      end.lineIndex,
      end.originalIndex,
      layout,
    );
    const chosen = direction < 0
      ? startCaret.visualX <= endCaret.visualX
        ? { index: target.selectionStart, caret: startCaret }
        : { index: target.selectionEnd, caret: endCaret }
      : startCaret.visualX >= endCaret.visualX
        ? { index: target.selectionStart, caret: startCaret }
        : { index: target.selectionEnd, caret: endCaret };
    setCollapsedSelection(target, chosen.index, start.lineIndex, chosen.caret);
    return true;
  }

  const activeIndex = event.shiftKey
    ? target._selectionDirection === 'left'
      ? target.selectionStart
      : target.selectionEnd
    : target.selectionStart;
  const location = getLineLocation(target, activeIndex);
  const layout = getLayout(target, location.lineIndex);
  const current = chooseCaret(
    target,
    activeIndex,
    location.lineIndex,
    location.originalIndex,
    layout,
  );
  const ordered = [...layout.carets].sort((a, b) => a.visualX - b.visualX);
  const epsilon = 0.5;
  const candidates = direction < 0
    ? ordered.filter((caret) => caret.visualX < current.visualX - epsilon)
    : ordered.filter((caret) => caret.visualX > current.visualX + epsilon);
  let next = direction < 0 ? candidates[candidates.length - 1] : candidates[0];
  let nextLine = location.lineIndex;

  if (!next) {
    nextLine += direction < 0 ? -1 : 1;
    if (nextLine < 0 || nextLine >= target._textLines.length) {
      return false;
    }
    const nextLayout = getLayout(target, nextLine);
    const nextOrdered = [...nextLayout.carets].sort((a, b) => a.visualX - b.visualX);
    next = direction < 0 ? nextOrdered[nextOrdered.length - 1] : nextOrdered[0];
  }

  const originalIndex = displayToOriginal(target, nextLine, next.displayIndex);
  const globalIndex = getLineStart(target, nextLine) + originalIndex;

  if (event.shiftKey) {
    target.setSelectionStartEndWithShift(
      target.selectionStart,
      target.selectionEnd,
      globalIndex,
    );
  } else {
    target.selectionStart = globalIndex;
    target.selectionEnd = globalIndex;
  }
  rememberCaret(target, globalIndex, nextLine, next);
  return true;
};

export const installNativeRtlEditing = () => {
  if (installed) {
    return;
  }
  installed = true;

  const prototype = IText.prototype as EditableText;
  const originalSelectWord = prototype.selectWord;
  const originalInitHiddenTextarea = prototype.initHiddenTextarea;
  const originalMoveCursorLeft = prototype.moveCursorLeft;
  const originalMoveCursorRight = prototype.moveCursorRight;

  // RTL key maps must call methods according to the visual arrow direction.
  (IText as any).ownDefaults.keysMapRtl = (IText as any).ownDefaults.keysMap;

  prototype.initHiddenTextarea = function () {
    originalInitHiddenTextarea.call(this);
    if (this.hiddenTextarea) {
      this.hiddenTextarea.dir = this.direction === 'rtl' ? 'rtl' : 'ltr';
      this.hiddenTextarea.style.direction = this.direction === 'rtl' ? 'rtl' : 'ltr';
      this.hiddenTextarea.style.unicodeBidi = 'plaintext';
    }
  };

  prototype.getSelectionStartFromPointer = function (event: any): number {
    const scenePoint = this.canvas.getScenePoint(event);
    const localPoint = scenePoint.transform(invertTransform(this.calcTransformMatrix()));
    const xFromLeft = localPoint.x + this.width / 2;
    const yFromTop = localPoint.y + this.height / 2;
    const lineIndex = getLineFromY(this, yFromTop);
    const layout = getLayout(this, lineIndex);
    const lineX = xFromLeft - getAlignmentOffset(this, lineIndex);
    const caret = nearestCaret(layout, lineX);
    const originalIndex = displayToOriginal(this, lineIndex, caret.displayIndex);
    const globalIndex = Math.min(
      getLineStart(this, lineIndex) + originalIndex,
      this._text.length,
    );
    rememberCaret(this, globalIndex, lineIndex, caret);
    return globalIndex;
  };

  prototype.__getCursorBoundariesOffsets = function (globalIndex: number) {
    const location = getLineLocation(this, globalIndex);
    const layout = getLayout(this, location.lineIndex);
    const caret = chooseCaret(
      this,
      globalIndex,
      location.lineIndex,
      location.originalIndex,
      layout,
    );
    const visualX = getAlignmentOffset(this, location.lineIndex) + caret.visualX;
    const left = this.direction === 'rtl' ? visualX - this.width : visualX;
    return {
      top: getLineTop(this, location.lineIndex),
      left,
    };
  };

  prototype._renderSelection = function (
    context: CanvasRenderingContext2D,
    selection: { selectionStart: number; selectionEnd: number },
    boundaries: { left: number; top: number; leftOffset: number; topOffset: number },
  ) {
    const selectionStart = Math.min(selection.selectionStart, selection.selectionEnd);
    const selectionEnd = Math.max(selection.selectionStart, selection.selectionEnd);
    if (selectionStart === selectionEnd) {
      return;
    }

    const startLocation = getLineLocation(this, selectionStart);
    const endLocation = getLineLocation(this, selectionEnd);

    for (let lineIndex = startLocation.lineIndex; lineIndex <= endLocation.lineIndex; lineIndex++) {
      const originalLength = getOriginalLineLength(this, lineIndex);
      const originalStart = lineIndex === startLocation.lineIndex ? startLocation.originalIndex : 0;
      const originalEnd = lineIndex === endLocation.lineIndex ? endLocation.originalIndex : originalLength;
      const displayStart = originalToDisplay(this, lineIndex, originalStart);
      const displayEnd = originalToDisplay(this, lineIndex, originalEnd);
      const layout = getLayout(this, lineIndex);
      const intervals = mergeVisualIntervals(
        layout.clusters
          .filter(
            (cluster) =>
              cluster.displayIndex >= displayStart && cluster.displayIndex < displayEnd,
          )
          .map((cluster) => ({ x: cluster.visualX, width: cluster.width })),
      );

      const lineHeight = this.getHeightOfLine(lineIndex);
      const drawHeight =
        this.lineHeight < 1 || (lineIndex === endLocation.lineIndex && this.lineHeight > 1)
          ? lineHeight / this.lineHeight
          : lineHeight;
      const extraTop = this.inCompositionMode ? lineHeight : 0;
      context.fillStyle = this.inCompositionMode
        ? this.compositionColor || 'black'
        : this.selectionColor;
      const effectiveHeight = this.inCompositionMode ? 1 : drawHeight;
      const baseX = -this.width / 2 + getAlignmentOffset(this, lineIndex);
      const y = boundaries.top + getLineTop(this, lineIndex) + extraTop;

      for (const interval of intervals) {
        context.fillRect(baseX + interval.x, y, interval.width, effectiveHeight);
      }
    }
  };

  prototype.selectWord = function (selectionStart?: number) {
    const graphemeIndex = selectionStart ?? this.selectionStart;
    if (typeof Intl === 'undefined' || !('Segmenter' in Intl)) {
      return originalSelectWord.call(this, graphemeIndex);
    }

    const graphemes: string[] = this.graphemeSplit(this.text);
    const offsets = new Array<number>(graphemes.length + 1);
    let utf16Offset = 0;
    for (let index = 0; index < graphemes.length; index++) {
      offsets[index] = utf16Offset;
      utf16Offset += graphemes[index].length;
    }
    offsets[graphemes.length] = utf16Offset;
    const targetOffset = offsets[Math.max(0, Math.min(graphemes.length, graphemeIndex))];
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
    let found: { start: number; end: number } | undefined;

    for (const segment of segmenter.segment(this.text) as any) {
      const start = segment.index;
      const end = start + segment.segment.length;
      if (targetOffset >= start && targetOffset <= end && segment.isWordLike) {
        const startIndex = offsets.findIndex((offset) => offset >= start);
        const endIndex = offsets.findIndex((offset) => offset >= end);
        found = {
          start: startIndex < 0 ? 0 : startIndex,
          end: endIndex < 0 ? graphemes.length : endIndex,
        };
        break;
      }
    }

    if (!found) {
      return originalSelectWord.call(this, graphemeIndex);
    }
    this.selectionStart = found.start;
    this.selectionEnd = found.end;
    this._fireSelectionChanged();
    this._updateTextarea();
    this.renderCursorOrSelection();
  };

  prototype.moveCursorLeft = function (event: KeyboardEvent) {
    if (!moveVisualCaret(this, -1, event)) {
      return originalMoveCursorLeft.call(this, event);
    }
    this._currentCursorOpacity = 1;
    this.abortCursorAnimation();
    this.initDelayedCursor();
    this._fireSelectionChanged();
    this._updateTextarea();
  };

  prototype.moveCursorRight = function (event: KeyboardEvent) {
    if (!moveVisualCaret(this, 1, event)) {
      return originalMoveCursorRight.call(this, event);
    }
    this._currentCursorOpacity = 1;
    this.abortCursorAnimation();
    this.initDelayedCursor();
    this._fireSelectionChanged();
    this._updateTextarea();
  };
};
