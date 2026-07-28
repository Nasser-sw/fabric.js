import { IText } from '../shapes/IText/IText';
import { invertTransform } from '../util/misc/matrix';
import {
  createVisualLineLayout,
  getVisualLineOffset,
  hitTestVisualCaret,
  mergeVisualIntervals,
  normalizeVisualAdvances,
  resolveBidiLevels,
  subdivideVisualClusterRun,
  type VisualCaret,
  type VisualCluster,
  type VisualLineLayout,
} from './rtlVisualLayout';

type EditableText = Record<string, any>;

type CaretState = {
  globalIndex: number;
  lineIndex: number;
  displayIndex: number;
  clusterDisplayIndex: number;
  visualX: number;
  affinity: 'before' | 'after';
};

const layoutCache = new WeakMap<
  object,
  Map<number, { hash: string; layout: VisualLineLayout }>
>();
let installed = false;

const getOriginalLineLength = (
  target: EditableText,
  lineIndex: number,
): number =>
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
    start +=
      getOriginalLineLength(target, index) + target.missingNewlineOffset(index);
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
    if (
      clamped <= lineStart + lineLength ||
      lineIndex === target._textLines.length - 1
    ) {
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

const getAlignmentOffset = (
  target: EditableText,
  lineIndex: number,
): number => {
  const lineWidth = target.getLineWidth(lineIndex);
  return getVisualLineOffset(
    target.width,
    lineWidth,
    target._getLineLeftOffset(lineIndex),
    target.direction === 'rtl' ? 'rtl' : 'ltr',
  );
};

/**
 * Canvas TextMetrics exposes only a run's total width, not the shaped glyph
 * advances needed for character-accurate Arabic carets. In browsers, measure
 * grapheme ranges in an invisible inline box so the same native shaping engine
 * supplies the visual cluster rectangles. The editor and selection remain
 * entirely canvas-rendered.
 */
const getBrowserShapedLayout = (
  target: EditableText,
  lineIndex: number,
  line: string[],
  lineWidth: number,
): VisualLineLayout | undefined => {
  const element = target.canvas?.getElement?.();
  const doc = element?.ownerDocument;
  if (
    !doc?.body ||
    typeof doc.createRange !== 'function' ||
    target.path ||
    !target.isEmptyStyles?.(lineIndex) ||
    line.length === 0
  ) {
    return undefined;
  }

  const measurer = doc.createElement('span');
  const textNode = doc.createTextNode(line.join(''));
  const direction = target.direction === 'rtl' ? 'rtl' : 'ltr';
  Object.assign(measurer.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    display: 'inline-block',
    visibility: 'hidden',
    pointerEvents: 'none',
    whiteSpace: 'pre',
    padding: '0',
    margin: '0',
    border: '0',
    font: target._getFontDeclaration(),
    fontKerning: 'normal',
    fontVariantLigatures: 'normal',
    letterSpacing: `${target._getWidthOfCharSpacing?.() || 0}px`,
    direction,
    // Keep the measurement isolated from surrounding DOM while honoring
    // Fabric's explicit paragraph direction. `plaintext` would instead choose
    // the base direction from the first strong character ("Hello" => LTR).
    unicodeBidi: 'isolate',
  });
  measurer.appendChild(textNode);
  doc.body.appendChild(measurer);

  try {
    const containerRect = measurer.getBoundingClientRect();
    if (!Number.isFinite(containerRect.width) || containerRect.width <= 0) {
      return undefined;
    }

    const scale = lineWidth > 0 ? lineWidth / containerRect.width : 1;
    const levels = resolveBidiLevels(line, direction);
    let clusters: VisualCluster[] = [];
    const utf16Offsets = [0];
    for (const grapheme of line) {
      utf16Offsets.push(
        utf16Offsets[utf16Offsets.length - 1] + grapheme.length,
      );
    }

    const measureRange = (
      utf16Start: number,
      utf16End: number,
    ): { visualX: number; width: number } | undefined => {
      const range = doc.createRange();
      if (typeof range.getClientRects !== 'function') {
        return undefined;
      }
      range.setStart(textNode, utf16Start);
      range.setEnd(textNode, utf16End);
      const rects: DOMRect[] = Array.from(range.getClientRects());
      range.detach?.();

      if (rects.length === 0) {
        return undefined;
      }

      const left = Math.min(...rects.map((rect) => rect.left));
      const right = Math.max(...rects.map((rect) => rect.right));
      const width = (right - left) * scale;
      if (!Number.isFinite(width) || width <= 0) {
        return undefined;
      }
      return {
        visualX: (left - containerRect.left) * scale,
        width,
      };
    };

    for (let displayIndex = 0; displayIndex < line.length; displayIndex++) {
      const measurement = measureRange(
        utf16Offsets[displayIndex],
        utf16Offsets[displayIndex + 1],
      );
      if (!measurement) {
        return undefined;
      }

      clusters.push({
        displayIndex,
        ...measurement,
        level: levels[displayIndex],
        isRtl: (levels[displayIndex] & 1) === 1,
      });
    }

    // Chromium exposes consecutive tatweels as overlapping pieces of one
    // cursive shaping cluster. Measure the full stretch once, then restore a
    // native-editor caret cell for each U+0640 without altering its total span.
    for (let start = 0; start < line.length; ) {
      if (line[start].codePointAt(0) !== 0x0640) {
        start++;
        continue;
      }
      let end = start + 1;
      while (end < line.length && line[end].codePointAt(0) === 0x0640) {
        end++;
      }
      if (end - start > 1) {
        const run = measureRange(utf16Offsets[start], utf16Offsets[end]);
        if (run) {
          clusters = subdivideVisualClusterRun(
            clusters,
            start,
            end,
            run.visualX,
            run.width,
          );
        }
      }
      start = end;
    }

    clusters.sort((a, b) => a.visualX - b.visualX);
    const carets: VisualCaret[] = [];
    for (const cluster of clusters) {
      carets.push({
        displayIndex: cluster.displayIndex,
        visualX: cluster.isRtl
          ? cluster.visualX + cluster.width
          : cluster.visualX,
        affinity: 'before',
        clusterDisplayIndex: cluster.displayIndex,
      });
      carets.push({
        displayIndex: cluster.displayIndex + 1,
        visualX: cluster.isRtl
          ? cluster.visualX
          : cluster.visualX + cluster.width,
        affinity: 'after',
        clusterDisplayIndex: cluster.displayIndex,
      });
    }

    return {
      clusters,
      carets,
      visualOrder: clusters.map(({ displayIndex }) => displayIndex),
      levels,
      width: lineWidth,
    };
  } finally {
    measurer.remove();
  }
};

const getLayout = (
  target: EditableText,
  lineIndex: number,
): VisualLineLayout => {
  const line = target._textLines[lineIndex] || [];
  // Ensure __charBounds has been populated lazily by Fabric.
  target._getLineLeftOffset(lineIndex);
  const bounds = target.__charBounds[lineIndex] || [];
  const lineWidth = target.getLineWidth(lineIndex);
  const widths = normalizeVisualAdvances(
    line.map((_: string, index: number) => bounds[index] || {}),
    lineWidth,
  );
  const hash = [
    target.direction,
    line.join(''),
    lineWidth,
    target._getFontDeclaration?.(),
    target._getWidthOfCharSpacing?.(),
    widths.join(','),
  ].join('|');
  let targetCache = layoutCache.get(target);
  if (!targetCache) {
    targetCache = new Map();
    layoutCache.set(target, targetCache);
  }
  const cached = targetCache.get(lineIndex);
  if (cached?.hash === hash) {
    return cached.layout;
  }
  const layout =
    getBrowserShapedLayout(target, lineIndex, line, lineWidth) ||
    createVisualLineLayout(
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
): VisualCaret[] =>
  layout.carets.filter((caret) => caret.displayIndex === displayIndex);

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
        ? candidates.reduce((best, caret) =>
            caret.visualX > best.visualX ? caret : best,
          )
        : candidates.reduce((best, caret) =>
            caret.visualX < best.visualX ? caret : best,
          );
    }
    if (originalIndex >= getOriginalLineLength(target, lineIndex)) {
      return target.direction === 'rtl'
        ? candidates.reduce((best, caret) =>
            caret.visualX < best.visualX ? caret : best,
          )
        : candidates.reduce((best, caret) =>
            caret.visualX > best.visualX ? caret : best,
          );
    }
    return (
      candidates.find((caret) => caret.affinity === 'before') || candidates[0]
    );
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
    clusterDisplayIndex: caret.clusterDisplayIndex,
    visualX: caret.visualX,
    affinity: caret.affinity,
  } satisfies CaretState;
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
  if (
    event.altKey ||
    event.metaKey ||
    event.ctrlKey ||
    event.keyCode === 35 ||
    event.keyCode === 36
  ) {
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
    const chosen =
      direction < 0
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
  const candidates =
    direction < 0
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
    const nextOrdered = [...nextLayout.carets].sort(
      (a, b) => a.visualX - b.visualX,
    );
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

  const prototype = IText.prototype as unknown as EditableText;
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
      this.hiddenTextarea.style.direction =
        this.direction === 'rtl' ? 'rtl' : 'ltr';
      this.hiddenTextarea.style.unicodeBidi = 'isolate';
    }
  };

  prototype.getSelectionStartFromPointer = function (event: any): number {
    const scenePoint = this.canvas!.getScenePoint(event);
    const localPoint = scenePoint.transform(
      invertTransform(this.calcTransformMatrix()),
    );
    const xFromLeft = localPoint.x + this.width / 2;
    const yFromTop = localPoint.y + this.height / 2;
    const lineIndex = getLineFromY(this, yFromTop);
    const layout = getLayout(this, lineIndex);
    const lineX = xFromLeft - getAlignmentOffset(this, lineIndex);
    const caret = hitTestVisualCaret(layout, lineX);
    const originalIndex = displayToOriginal(
      this,
      lineIndex,
      caret.displayIndex,
    );
    const globalIndex = Math.min(
      getLineStart(this, lineIndex) + originalIndex,
      this._text.length,
    );
    rememberCaret(this, globalIndex, lineIndex, caret);
    return globalIndex;
  };

  prototype._getNativeVisualLineLayout = function (
    lineIndex: number,
  ): VisualLineLayout {
    return getLayout(this, lineIndex);
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
    const visualX =
      getAlignmentOffset(this, location.lineIndex) + caret.visualX;
    const left = this.direction === 'rtl' ? visualX - this.width : visualX;
    return {
      top: getLineTop(this, location.lineIndex),
      left,
    };
  };

  prototype._renderSelection = function (
    context: CanvasRenderingContext2D,
    selection: { selectionStart: number; selectionEnd: number },
    boundaries: {
      left: number;
      top: number;
      leftOffset: number;
      topOffset: number;
    },
  ) {
    const selectionStart = Math.min(
      selection.selectionStart,
      selection.selectionEnd,
    );
    const selectionEnd = Math.max(
      selection.selectionStart,
      selection.selectionEnd,
    );
    if (selectionStart === selectionEnd) {
      return;
    }

    const startLocation = getLineLocation(this, selectionStart);
    const endLocation = getLineLocation(this, selectionEnd);

    for (
      let lineIndex = startLocation.lineIndex;
      lineIndex <= endLocation.lineIndex;
      lineIndex++
    ) {
      const originalLength = getOriginalLineLength(this, lineIndex);
      const originalStart =
        lineIndex === startLocation.lineIndex ? startLocation.originalIndex : 0;
      const originalEnd =
        lineIndex === endLocation.lineIndex
          ? endLocation.originalIndex
          : originalLength;
      const displayStart = originalToDisplay(this, lineIndex, originalStart);
      const displayEnd = originalToDisplay(this, lineIndex, originalEnd);
      const layout = getLayout(this, lineIndex);
      const intervals = mergeVisualIntervals(
        layout.clusters
          .filter(
            (cluster) =>
              cluster.displayIndex >= displayStart &&
              cluster.displayIndex < displayEnd,
          )
          .map((cluster) => ({ x: cluster.visualX, width: cluster.width })),
      );

      const lineHeight = this.getHeightOfLine(lineIndex);
      const drawHeight =
        this.lineHeight < 1 ||
        (lineIndex === endLocation.lineIndex && this.lineHeight > 1)
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
        context.fillRect(
          baseX + interval.x,
          y,
          interval.width,
          effectiveHeight,
        );
      }
    }
  };

  prototype.selectWord = function (selectionStart?: number) {
    let graphemeIndex = selectionStart ?? this.selectionStart;
    if (typeof Intl === 'undefined' || !('Segmenter' in Intl)) {
      return originalSelectWord.call(this, graphemeIndex);
    }

    const graphemes: string[] = this.graphemeSplit(this.text);
    const caretState = this.__nativeRtlCaretState as CaretState | undefined;
    if (caretState && caretState.globalIndex === graphemeIndex) {
      const clickedOriginalIndex = displayToOriginal(
        this,
        caretState.lineIndex,
        Math.max(0, caretState.clusterDisplayIndex),
      );
      graphemeIndex =
        getLineStart(this, caretState.lineIndex) +
        Math.min(
          clickedOriginalIndex,
          Math.max(0, getOriginalLineLength(this, caretState.lineIndex) - 1),
        );
    }
    const offsets = new Array<number>(graphemes.length + 1);
    let utf16Offset = 0;
    for (let index = 0; index < graphemes.length; index++) {
      offsets[index] = utf16Offset;
      utf16Offset += graphemes[index].length;
    }
    offsets[graphemes.length] = utf16Offset;
    const targetOffset =
      offsets[Math.max(0, Math.min(graphemes.length, graphemeIndex))];
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
    let found: { start: number; end: number } | undefined;

    for (const segment of segmenter.segment(this.text) as any) {
      const start = segment.index;
      const end = start + segment.segment.length;
      if (targetOffset >= start && targetOffset < end && segment.isWordLike) {
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
