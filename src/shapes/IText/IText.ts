import { Canvas } from '../../canvas/Canvas';
import type { ITextEvents } from './ITextBehavior';
import { ITextClickBehavior } from './ITextClickBehavior';
import { getCursorRect } from '../../text/hitTest';
import { analyzeBiDi } from '../../text/unicode';
import {
  ctrlKeysMapDown,
  ctrlKeysMapUp,
  keysMap,
  keysMapRtl,
} from './constants';
import type { TClassProperties, TFiller, TOptions } from '../../typedefs';
import type { TPointerEvent } from '../../EventTypeDefs';
import { classRegistry } from '../../ClassRegistry';
import type { SerializedTextProps, TextProps } from '../Text/Text';
import {
  JUSTIFY,
  JUSTIFY_CENTER,
  JUSTIFY_LEFT,
  JUSTIFY_RIGHT,
} from '../Text/constants';
import { CENTER, FILL, LEFT, RIGHT } from '../../constants';
import type { ObjectToCanvasElementOptions } from '../Object/Object';
import type { FabricObject } from '../Object/FabricObject';
import { createCanvasElementFor } from '../../util/misc/dom';
import { applyCanvasTransform } from '../../util/internals/applyCanvasTransform';
import { invertTransform } from '../../util/misc/matrix';

export type CursorBoundaries = {
  left: number;
  top: number;
  leftOffset: number;
  topOffset: number;
};

export type CursorRenderingData = {
  color: string;
  opacity: number;
  left: number;
  top: number;
  width: number;
  height: number;
};

// Declare IText protected properties to workaround TS
const protectedDefaultValues = {
  _selectionDirection: null,
  _reSpace: /\s|\r?\n/,
  inCompositionMode: false,
};

export const iTextDefaultValues: Partial<TClassProperties<IText>> = {
  selectionStart: 0,
  selectionEnd: 0,
  selectionColor: 'rgba(17,119,255,0.3)',
  isEditing: false,
  editable: true,
  editingBorderColor: 'rgba(102,153,255,0.25)',
  cursorWidth: 2,
  cursorColor: '',
  cursorDelay: 1000,
  cursorDuration: 600,
  caching: true,
  hiddenTextareaContainer: null,
  keysMap,
  keysMapRtl,
  ctrlKeysMapDown,
  ctrlKeysMapUp,
  ...protectedDefaultValues,
};

// @TODO this is not complete
interface UniqueITextProps {
  selectionStart: number;
  selectionEnd: number;
}

export interface SerializedITextProps
  extends SerializedTextProps,
  UniqueITextProps { }

export interface ITextProps extends TextProps, UniqueITextProps { }

/**
 * @fires changed
 * @fires selection:changed
 * @fires editing:entered
 * @fires editing:exited
 * @fires dragstart
 * @fires drag drag event firing on the drag source
 * @fires dragend
 * @fires copy
 * @fires cut
 * @fires paste
 *
 * #### Supported key combinations
 * ```
 *   Move cursor:                    left, right, up, down
 *   Select character:               shift + left, shift + right
 *   Select text vertically:         shift + up, shift + down
 *   Move cursor by word:            alt + left, alt + right
 *   Select words:                   shift + alt + left, shift + alt + right
 *   Move cursor to line start/end:  cmd + left, cmd + right or home, end
 *   Select till start/end of line:  cmd + shift + left, cmd + shift + right or shift + home, shift + end
 *   Jump to start/end of text:      cmd + up, cmd + down
 *   Select till start/end of text:  cmd + shift + up, cmd + shift + down or shift + pgUp, shift + pgDown
 *   Delete character:               backspace
 *   Delete word:                    alt + backspace
 *   Delete line:                    cmd + backspace
 *   Forward delete:                 delete
 *   Copy text:                      ctrl/cmd + c
 *   Paste text:                     ctrl/cmd + v
 *   Cut text:                       ctrl/cmd + x
 *   Select entire text:             ctrl/cmd + a
 *   Quit editing                    tab or esc
 * ```
 *
 * #### Supported mouse/touch combination
 * ```
 *   Position cursor:                click/touch
 *   Create selection:               click/touch & drag
 *   Create selection:               click & shift + click
 *   Select word:                    double click
 *   Select line:                    triple click
 * ```
 */
export class IText<
  Props extends TOptions<ITextProps> = Partial<ITextProps>,
  SProps extends SerializedITextProps = SerializedITextProps,
  EventSpec extends ITextEvents = ITextEvents,
>
  extends ITextClickBehavior<Props, SProps, EventSpec>
  implements UniqueITextProps {
  /**
   * Index where text selection starts (or where cursor is when there is no selection)
   * @type Number
   */
  declare selectionStart: number;

  /**
   * Index where text selection ends
   * @type Number
   */
  declare selectionEnd: number;

  /**
   * Cache for visual positions per line to ensure consistency
   * during selection operations
   * @private
   */
  private _visualPositionsCache: Map<number, Array<{
    logicalIndex: number;
    visualX: number;
    width: number;
    isRtl: boolean;
  }>> = new Map();

  declare compositionStart: number;

  declare compositionEnd: number;

  /**
   * Color of text selection
   * @type String
   */
  declare selectionColor: string;

  /**
   * Indicates whether text is in editing mode
   * @type Boolean
   */
  declare isEditing: boolean;

  /**
   * Indicates whether a text can be edited
   * @type Boolean
   */
  declare editable: boolean;

  /**
   * Border color of text object while it's in editing mode
   * @type String
   */
  declare editingBorderColor: string;

  /**
   * Width of cursor (in px)
   * @type Number
   */
  declare cursorWidth: number;

  /**
   * Color of text cursor color in editing mode.
   * if not set (default) will take color from the text.
   * if set to a color value that fabric can understand, it will
   * be used instead of the color of the text at the current position.
   * @type String
   */
  declare cursorColor: string;

  /**
   * Delay between cursor blink (in ms)
   * @type Number
   */
  declare cursorDelay: number;

  /**
   * Duration of cursor fade in (in ms)
   * @type Number
   */
  declare cursorDuration: number;

  declare compositionColor: string;

  /**
   * Indicates whether internal text char widths can be cached
   * @type Boolean
   */
  declare caching: boolean;

  static ownDefaults = iTextDefaultValues;

  static getDefaults(): Record<string, any> {
    return { ...super.getDefaults(), ...IText.ownDefaults };
  }

  static type = 'IText';

  get type() {
    const type = super.type;
    // backward compatibility
    return type === 'itext' ? 'i-text' : type;
  }

  /**
   * Constructor
   * @param {String} text Text string
   * @param {Object} [options] Options object
   */
  constructor(text: string, options?: Props) {
    super(text, { ...IText.ownDefaults, ...options } as Props);
    this.initBehavior();
  }

  /**
   * While editing handle differently
   * @private
   * @param {string} key
   * @param {*} value
   */
  _set(key: string, value: any) {
    if (this.isEditing && this._savedProps && key in this._savedProps) {
      // @ts-expect-error irritating TS
      this._savedProps[key] = value;
      return this;
    }
    if (key === 'canvas') {
      this.canvas instanceof Canvas &&
        this.canvas.textEditingManager.remove(this);
      value instanceof Canvas && value.textEditingManager.add(this);
    }
    return super._set(key, value);
  }

  /**
   * Sets selection start (left boundary of a selection)
   * @param {Number} index Index to set selection start to
   */
  setSelectionStart(index: number) {
    index = Math.max(index, 0);
    this._updateAndFire('selectionStart', index);
  }

  /**
   * Sets selection end (right boundary of a selection)
   * @param {Number} index Index to set selection end to
   */
  setSelectionEnd(index: number) {
    index = Math.min(index, this.text.length);
    this._updateAndFire('selectionEnd', index);
  }

  /**
   * @private
   * @param {String} property 'selectionStart' or 'selectionEnd'
   * @param {Number} index new position of property
   */
  protected _updateAndFire(
    property: 'selectionStart' | 'selectionEnd',
    index: number,
  ) {
    if (this[property] !== index) {
      this._fireSelectionChanged();
      this[property] = index;
    }
    this._updateTextarea();
  }

  /**
   * Fires the even of selection changed
   * @private
   */
  _fireSelectionChanged() {
    this.fire('selection:changed');
    this.canvas && this.canvas.fire('text:selection:changed', { target: this });
  }

  /**
   * Initialize text dimensions. Render all text on given context
   * or on a offscreen canvas to get the text width with measureText.
   * Updates this.width and this.height with the proper values.
   * Does not return dimensions.
   * @private
   */
  initDimensions() {
    this.isEditing && this.initDelayedCursor();
    super.initDimensions();
  }

  /**
   * Gets style of a current selection/cursor (at the start position)
   * if startIndex or endIndex are not provided, selectionStart or selectionEnd will be used.
   * @param {Number} startIndex Start index to get styles at
   * @param {Number} endIndex End index to get styles at, if not specified selectionEnd or startIndex + 1
   * @param {Boolean} [complete] get full style or not
   * @return {Array} styles an array with one, zero or more Style objects
   */
  getSelectionStyles(
    startIndex: number = this.selectionStart || 0,
    endIndex: number = this.selectionEnd,
    complete?: boolean,
  ) {
    return super.getSelectionStyles(startIndex, endIndex, complete);
  }

  /**
   * Sets style of a current selection, if no selection exist, do not set anything.
   * @param {Object} [styles] Styles object
   * @param {Number} [startIndex] Start index to get styles at
   * @param {Number} [endIndex] End index to get styles at, if not specified selectionEnd or startIndex + 1
   */
  setSelectionStyles(
    styles: object,
    startIndex: number = this.selectionStart || 0,
    endIndex: number = this.selectionEnd,
  ) {
    return super.setSelectionStyles(styles, startIndex, endIndex);
  }

  /**
   * Returns 2d representation (lineIndex and charIndex) of cursor (or selection start)
   * @param {Number} [selectionStart] Optional index. When not given, current selectionStart is used.
   * @param {Boolean} [skipWrapping] consider the location for unwrapped lines. useful to manage styles.
   */
  get2DCursorLocation(
    selectionStart = this.selectionStart,
    skipWrapping?: boolean,
  ) {
    return super.get2DCursorLocation(selectionStart, skipWrapping);
  }

  /**
   * @private
   * @param {CanvasRenderingContext2D} ctx Context to render on
   */
  render(ctx: CanvasRenderingContext2D) {
    super.render(ctx);
    // clear the cursorOffsetCache, so we ensure to calculate once per renderCursor
    // the correct position but not at every cursor animation.
    this.cursorOffsetCache = {};
    // Clear visual positions cache on full render since dimensions may have changed
    this._clearVisualPositionsCache();
    this.renderCursorOrSelection();
  }

  /**
   * @override block cursor/selection logic while rendering the exported canvas
   * @todo this workaround should be replaced with a more robust solution
   */
  toCanvasElement(options?: ObjectToCanvasElementOptions): HTMLCanvasElement {
    const isEditing = this.isEditing;
    this.isEditing = false;
    const canvas = super.toCanvasElement(options);
    this.isEditing = isEditing;
    return canvas;
  }

  /**
   * Renders cursor or selection (depending on what exists)
   * it does on the contextTop. If contextTop is not available, do nothing.
   */
  renderCursorOrSelection() {
    if (!this.isEditing || !this.canvas) {
      return;
    }
    const ctx = this.clearContextTop(true);
    if (!ctx) {
      return;
    }
    // Clear cache to ensure fresh cursor position calculation
    // This is important during selection drag when positions change frequently
    this.cursorOffsetCache = {};
    const boundaries = this._getCursorBoundaries();

    const ancestors = this.findAncestorsWithClipPath();
    const hasAncestorsWithClipping = ancestors.length > 0;
    let drawingCtx: CanvasRenderingContext2D = ctx;
    let drawingCanvas: HTMLCanvasElement | undefined = undefined;
    if (hasAncestorsWithClipping) {
      // we have some clipPath, we need to draw the selection on an intermediate layer.
      drawingCanvas = createCanvasElementFor(ctx.canvas);
      drawingCtx = drawingCanvas.getContext('2d')!;
      applyCanvasTransform(drawingCtx, this.canvas);
      const m = this.calcTransformMatrix();
      drawingCtx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    }

    if (this.selectionStart === this.selectionEnd && !this.inCompositionMode) {
      this.renderCursor(drawingCtx, boundaries);
    } else {
      this.renderSelection(drawingCtx, boundaries);
    }

    if (hasAncestorsWithClipping) {
      // we need a neutral context.
      // this won't work for nested clippaths in which a clippath
      // has its own clippath
      for (const ancestor of ancestors) {
        const clipPath = ancestor.clipPath!;
        const clippingCanvas = createCanvasElementFor(ctx.canvas);
        const clippingCtx = clippingCanvas.getContext('2d')!;
        applyCanvasTransform(clippingCtx, this.canvas);
        // position the ctx in the center of the outer ancestor
        if (!clipPath.absolutePositioned) {
          const m = ancestor.calcTransformMatrix();
          clippingCtx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
        }
        clipPath.transform(clippingCtx);
        // we assign an empty drawing context, we don't plan to have this working for nested clippaths for now
        clipPath.drawObject(clippingCtx, true, {});
        this.drawClipPathOnCache(drawingCtx, clipPath, clippingCanvas);
      }
    }

    if (hasAncestorsWithClipping) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(drawingCanvas!, 0, 0);
    }

    this.canvas.contextTopDirty = true;
    ctx.restore();
  }

  /**
   * Finds and returns an array of clip paths that are applied to the parent
   * group(s) of the current FabricObject instance. The object's hierarchy is
   * traversed upwards (from the current object towards the root of the canvas),
   * checking each parent object for the presence of a `clipPath` that is not
   * absolutely positioned.
   */
  findAncestorsWithClipPath(): FabricObject[] {
    const clipPathAncestors: FabricObject[] = [];
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let obj: FabricObject | undefined = this;
    while (obj) {
      if (obj.clipPath) {
        clipPathAncestors.push(obj);
      }
      obj = obj.parent;
    }

    return clipPathAncestors;
  }

  /**
   * Returns cursor boundaries (left, top, leftOffset, topOffset)
   * left/top are left/top of entire text box
   * leftOffset/topOffset are offset from that left/top point of a text box
   * @private
   * @param {number} [index] index from start
   * @param {boolean} [skipCaching]
   */
  _getCursorBoundaries(
    index: number = this.selectionStart,
    skipCaching?: boolean,
  ): CursorBoundaries {
    // Always use original method which uses __charBounds directly
    // and has proper RTL handling built-in
    return this._getCursorBoundariesOriginal(index, skipCaching);
  }


  /**
   * Caches and returns cursor left/top offset relative to instance's center point
   * @private
   * @param {number} index index from start
   * @param {boolean} [skipCaching]
   */
  _getCursorBoundariesOffsets(
    index: number,
    skipCaching?: boolean,
  ): { left: number; top: number } {
    if (skipCaching) {
      return this.__getCursorBoundariesOffsets(index);
    }
    if (this.cursorOffsetCache && 'top' in this.cursorOffsetCache) {
      return this.cursorOffsetCache as { left: number; top: number };
    }
    return (this.cursorOffsetCache = this.__getCursorBoundariesOffsets(index));
  }

  /**
   * Enhanced cursor boundaries using advanced hit testing when available
   * @private
   */
  _getCursorBoundariesAdvanced(index: number): CursorBoundaries {
    if (!this.enableAdvancedLayout || !(this as any)._layoutTextAdvanced) {
      return this._getCursorBoundariesOriginal(index);
    }

    const layout = (this as any)._layoutTextAdvanced();
    const cursorRect = getCursorRect(index, layout, (this as any)._getAdvancedLayoutOptions());

    return {
      left: this._getLeftOffset(),
      top: this._getTopOffset(),
      leftOffset: cursorRect.x,
      topOffset: cursorRect.y,
    };
  }

  /**
   * Override selection to use measureText-based visual positions
   * This ensures hit testing matches actual browser BiDi rendering
   */
  getSelectionStartFromPointer(e: TPointerEvent): number {
    // Get mouse position in object-local coordinates (origin at center)
    const scenePoint = this.canvas!.getScenePoint(e);
    const localPoint = scenePoint.transform(invertTransform(this.calcTransformMatrix()));

    // Convert to top-left origin coordinates
    const mouseX = localPoint.x + this.width / 2;
    const mouseY = localPoint.y + this.height / 2;

    // Find the line based on Y position
    let height = 0, lineIndex = 0;
    for (let i = 0; i < this._textLines.length; i++) {
      const lineHeight = this.getHeightOfLine(i);
      if (mouseY >= height && mouseY < height + lineHeight) {
        lineIndex = i;
        break;
      }
      height += lineHeight;
      if (i === this._textLines.length - 1) {
        lineIndex = i;
      }
    }

    // Calculate line start index using ORIGINAL line lengths (without tatweels)
    // This ensures selection indices refer to the original text, not the display text
    let lineStartIndex = 0;
    for (let i = 0; i < lineIndex; i++) {
      const origLen = this._getOriginalLineLength(i);
      const newlineOffset = this.missingNewlineOffset(i);
      // console.log(`📍 Line ${i}: origLen=${origLen}, displayLen=${this._textLines[i].length}, tatweels=${this._getTatweelCountForLine(i)}, newlineOffset=${newlineOffset}`);
      lineStartIndex += origLen + newlineOffset;
    }
    // console.log(`📍 Click on line ${lineIndex}, lineStartIndex=${lineStartIndex}`);

    const line = this._textLines[lineIndex];
    const lineText = line.join('');
    const displayCharLength = line.length;
    const originalCharLength = this._getOriginalLineLength(lineIndex);

    if (displayCharLength === 0) {
      return lineStartIndex;
    }

    // Use measureText to get actual visual character positions
    // This matches exactly how the canvas renders BiDi text
    const visualPositions = this._measureVisualPositions(lineIndex, lineText);

    // Calculate line offset based on alignment
    const lineWidth = this.getLineWidth(lineIndex);
    let lineStartX = 0;

    if (this.textAlign === 'center' || this.textAlign === 'justify-center') {
      lineStartX = (this.width - lineWidth) / 2;
    } else if (this.textAlign === 'right' || this.textAlign === 'justify-right') {
      lineStartX = this.width - lineWidth;
    } else if (this.direction === 'rtl' && (this.textAlign === 'justify' || this.textAlign === 'left')) {
      // For RTL with left/justify, text starts from right
      lineStartX = this.width - lineWidth;
    }

    // Find which character was clicked based on visual position
    const clickX = mouseX - lineStartX;

    // Sort positions by visual X for hit testing
    const sortedPositions = [...visualPositions].sort((a, b) => a.visualX - b.visualX);

    // Handle click before first character
    if (sortedPositions.length > 0 && clickX < sortedPositions[0].visualX) {
      // Before first visual character - cursor at visual left edge
      // For RTL base direction, this means logical end of line
      return this.direction === 'rtl'
        ? lineStartIndex + originalCharLength
        : lineStartIndex;
    }

    // Handle click after last character
    if (sortedPositions.length > 0) {
      const lastPos = sortedPositions[sortedPositions.length - 1];
      if (clickX > lastPos.visualX + lastPos.width) {
        // After last visual character - cursor at visual right edge
        // For RTL base direction, this means logical start of line
        return this.direction === 'rtl'
          ? lineStartIndex
          : lineStartIndex + originalCharLength;
      }
    }

    // Find the character at click position
    for (let i = 0; i < sortedPositions.length; i++) {
      const pos = sortedPositions[i];
      const charEnd = pos.visualX + pos.width;

      if (clickX >= pos.visualX && clickX <= charEnd) {
        // Convert display index to original index
        // This also handles tatweels - they map to the character they extend
        const originalCharIndex = this._displayToOriginalIndex(lineIndex, pos.logicalIndex);

        // Check if this is a tatweel - if so, treat click as clicking on the extended character
        const isTatweel = this._isTatweelAtDisplayIndex(lineIndex, pos.logicalIndex);

        // console.log(`📍 Hit char: displayIdx=${pos.logicalIndex}, origIdx=${originalCharIndex}, isTatweel=${isTatweel}, char="${this._textLines[lineIndex][pos.logicalIndex]}"`);

        const charMiddle = pos.visualX + pos.width / 2;
        const clickedLeftHalf = clickX <= charMiddle;

        // For tatweels, clicking anywhere on it should place cursor after the extended character
        if (isTatweel) {
          // Tatweel extends the character before it, so cursor goes after that character
          // originalCharIndex from _displayToOriginalIndex already maps tatweel to char+1
          const result = lineStartIndex + originalCharIndex;
          // console.log(`📍 Tatweel click result: ${result}`);
          return result;
        }

        // For RTL characters: left visual half means cursor AFTER (higher logical index)
        // For LTR characters: left visual half means cursor BEFORE (lower logical index)
        if (pos.isRtl) {
          // RTL character
          const result = lineStartIndex + (clickedLeftHalf ? originalCharIndex + 1 : originalCharIndex);
          // console.log(`📍 RTL char result: ${result} (clickedLeftHalf=${clickedLeftHalf})`);
          return result;
        } else {
          // LTR character
          const result = lineStartIndex + (clickedLeftHalf ? originalCharIndex : originalCharIndex + 1);
          // console.log(`📍 LTR char result: ${result} (clickedLeftHalf=${clickedLeftHalf})`);
          return result;
        }
      }
    }

    // console.log(`📍 No match, returning end: ${lineStartIndex + originalCharLength}`);
    return lineStartIndex + originalCharLength;
  }

  /**
   * Clear the visual positions cache
   * Should be called when text content or dimensions change
   */
  _clearVisualPositionsCache() {
    this._visualPositionsCache.clear();
  }

  /**
   * Measure visual character positions for hit testing using BiDi analysis
   * This properly handles mixed RTL/LTR text by analyzing BiDi runs
   * Results are cached per line for consistency during selection operations
   */
  _measureVisualPositions(lineIndex: number, lineText: string): Array<{
    logicalIndex: number;
    visualX: number;
    width: number;
    isRtl: boolean;  // Direction of this character's run
  }> {
    // Check cache first
    if (this._visualPositionsCache.has(lineIndex)) {
      return this._visualPositionsCache.get(lineIndex)!;
    }

    const line = this._textLines[lineIndex];
    const positions: Array<{logicalIndex: number; visualX: number; width: number; isRtl: boolean}> = [];

    const chars = this.__charBounds[lineIndex];
    if (!chars || chars.length === 0) {
      this._visualPositionsCache.set(lineIndex, positions);
      return positions;
    }

    // For LTR direction, use logical positions directly
    if (this.direction !== 'rtl') {
      for (let i = 0; i < line.length; i++) {
        positions.push({
          logicalIndex: i,
          visualX: chars[i]?.left || 0,
          width: chars[i]?.kernedWidth || 0,
          isRtl: false,
        });
      }
      this._visualPositionsCache.set(lineIndex, positions);
      return positions;
    }

    // For RTL, use BiDi analysis to determine visual positions
    const runs = analyzeBiDi(lineText, 'rtl');

    // Build mapping from string position to grapheme index
    // This is needed because analyzeBiDi works on string positions (code points)
    // but we need grapheme indices for charBounds
    const stringPosToGrapheme: number[] = [];
    let strPos = 0;
    for (let gi = 0; gi < line.length; gi++) {
      const grapheme = line[gi];
      for (let j = 0; j < grapheme.length; j++) {
        stringPosToGrapheme[strPos + j] = gi;
      }
      strPos += grapheme.length;
    }

    // Calculate width for each run
    interface RunInfo {
      run: typeof runs[0];
      width: number;
      charIndices: number[];
    }

    const runInfos: RunInfo[] = [];

    for (const run of runs) {
      const runChars: number[] = [];
      let runWidth = 0;
      const seenGraphemes = new Set<number>();

      // Map string positions in this run to grapheme indices
      for (let sp = run.start; sp < run.end; sp++) {
        const gi = stringPosToGrapheme[sp];
        if (gi !== undefined && !seenGraphemes.has(gi)) {
          seenGraphemes.add(gi);
          runChars.push(gi);
          runWidth += chars[gi]?.kernedWidth || 0;
        }
      }

      runInfos.push({
        run,
        width: runWidth,
        charIndices: runChars,
      });
    }

    // For RTL base direction, runs are displayed right-to-left
    // So first run appears on the right, last run on the left
    const totalWidth = this.getLineWidth(lineIndex);
    let visualX = totalWidth; // Start from right edge

    for (const runInfo of runInfos) {
      visualX -= runInfo.width; // Move left by run width

      const isRtlRun = runInfo.run.direction === 'rtl';
      if (isRtlRun) {
        // RTL run: characters displayed right-to-left within run
        // First char of run at visual right of run, last at visual left
        let charX = visualX + runInfo.width;
        for (const idx of runInfo.charIndices) {
          const charWidth = chars[idx]?.kernedWidth || 0;
          charX -= charWidth;
          positions.push({
            logicalIndex: idx,
            visualX: charX,
            width: charWidth,
            isRtl: true,
          });
        }
      } else {
        // LTR run: characters displayed left-to-right within run
        // First char of run at visual left of run, last at visual right
        let charX = visualX;
        for (const idx of runInfo.charIndices) {
          const charWidth = chars[idx]?.kernedWidth || 0;
          positions.push({
            logicalIndex: idx,
            visualX: charX,
            width: charWidth,
            isRtl: false,
          });
          charX += charWidth;
        }
      }
    }

    // Cache the result
    this._visualPositionsCache.set(lineIndex, positions);
    return positions;
  }

  /**
   * Original cursor boundaries implementation
   * @private
   */
  _getCursorBoundariesOriginal(index: number, skipCaching?: boolean): CursorBoundaries {
    const left = this._getLeftOffset(),
      top = this._getTopOffset(),
      offsets = this._getCursorBoundariesOffsets(index, skipCaching);
    return {
      left: left,
      top: top,
      leftOffset: offsets.left,
      topOffset: offsets.top,
    };
  }

  /**
   * Calculates cursor left/top offset relative to _getLeftOffset()
   * Uses visual positions for BiDi text support
   * Handles kashida by converting original indices to display indices
   * @private
   * @param {number} index index from start (in original text space, without tatweels)
   */
  __getCursorBoundariesOffsets(index: number) {
    let topOffset = 0;

    // Find line index and original char index using original line lengths
    let lineIndex = 0;
    let originalCharIndex = index;

    for (let i = 0; i < this._textLines.length; i++) {
      const originalLineLength = this._getOriginalLineLength(i);
      if (originalCharIndex <= originalLineLength) {
        lineIndex = i;
        break;
      }
      originalCharIndex -= originalLineLength + this.missingNewlineOffset(i);
      lineIndex = i + 1;
    }

    // Clamp lineIndex to valid range
    if (lineIndex >= this._textLines.length) {
      lineIndex = this._textLines.length - 1;
      originalCharIndex = this._getOriginalLineLength(lineIndex);
    }

    for (let i = 0; i < lineIndex; i++) {
      topOffset += this.getHeightOfLine(i);
    }

    // Convert original char index to display char index for visual lookup
    const displayCharIndex = this._originalToDisplayIndex(lineIndex, originalCharIndex);

    // Get visual positions for cursor placement
    const lineText = this._textLines[lineIndex].join('');
    const visualPositions = this._measureVisualPositions(lineIndex, lineText);
    const lineWidth = this.getLineWidth(lineIndex);
    const displayLineLength = this._textLines[lineIndex].length;
    const originalLineLength = this._getOriginalLineLength(lineIndex);

    // Find visual X position for cursor (0 to lineWidth, from visual left)
    let visualX = 0;

    if (visualPositions.length === 0) {
      // Fallback for empty line
      return { top: topOffset, left: 0 };
    }

    if (originalCharIndex === 0) {
      // Cursor at logical start
      // For RTL base direction, logical start is at visual right
      if (this.direction === 'rtl') {
        visualX = lineWidth; // Right edge
      } else {
        visualX = 0; // Left edge
      }
    } else if (originalCharIndex >= originalLineLength) {
      // Cursor at logical end
      // For RTL base direction, logical end is at visual left
      if (this.direction === 'rtl') {
        visualX = 0; // Left edge
      } else {
        visualX = lineWidth; // Right edge
      }
    } else {
      // Cursor between characters - find visual position of character at displayCharIndex
      const charPos = visualPositions.find(p => p.logicalIndex === displayCharIndex);
      if (charPos) {
        // Use character's direction to determine cursor position
        // For RTL char: cursor "before" it appears at its right visual edge
        // For LTR char: cursor "before" it appears at its left visual edge
        if (charPos.isRtl) {
          visualX = charPos.visualX + charPos.width;
        } else {
          visualX = charPos.visualX;
        }
      } else {
        // Fallback - try the previous character in display space
        const prevDisplayIndex = displayCharIndex > 0 ? displayCharIndex - 1 : 0;
        const prevCharPos = visualPositions.find(p => p.logicalIndex === prevDisplayIndex);
        if (prevCharPos) {
          // Cursor after previous character
          if (prevCharPos.isRtl) {
            visualX = prevCharPos.visualX;
          } else {
            visualX = prevCharPos.visualX + prevCharPos.width;
          }
        } else {
          // Ultimate fallback
          const bound = this.__charBounds[lineIndex][displayCharIndex];
          visualX = bound?.left || 0;
        }
      }
    }

    // Calculate alignment offset (how much line is shifted from left edge)
    let alignOffset = 0;
    if (this.textAlign === 'center' || this.textAlign === 'justify-center') {
      alignOffset = (this.width - lineWidth) / 2;
    } else if (this.textAlign === 'right' || this.textAlign === 'justify-right') {
      alignOffset = this.width - lineWidth;
    } else if (this.direction === 'rtl' && (this.textAlign === 'justify' || this.textAlign === 'left')) {
      alignOffset = this.width - lineWidth;
    }

    // The returned left value is added to _getLeftOffset() in _getCursorBoundaries
    // _getLeftOffset() returns -width/2 for LTR, +width/2 for RTL
    // Final cursor X = _getLeftOffset() + leftOffset
    //
    // For LTR: cursor X = -width/2 + (alignOffset + visualX)
    // For RTL: cursor X = +width/2 + leftOffset
    //          We want cursor at: -width/2 + alignOffset + visualX
    //          So leftOffset = -width/2 + alignOffset + visualX - width/2 = alignOffset + visualX - width

    let leftOffset: number;
    if (this.direction === 'rtl') {
      // For RTL, _getLeftOffset() = +width/2
      // We want final X = -width/2 + alignOffset + visualX
      // So: +width/2 + leftOffset = -width/2 + alignOffset + visualX
      // leftOffset = -width + alignOffset + visualX
      leftOffset = -this.width + alignOffset + visualX;
    } else {
      // For LTR, _getLeftOffset() = -width/2
      // We want final X = -width/2 + alignOffset + visualX
      // So: -width/2 + leftOffset = -width/2 + alignOffset + visualX
      // leftOffset = alignOffset + visualX
      leftOffset = alignOffset + visualX;
    }

    return {
      top: topOffset,
      left: leftOffset,
    };
  }

  /**
   * Renders cursor on context Top, outside the animation cycle, on request
   * Used for the drag/drop effect.
   * If contextTop is not available, do nothing.
   */
  renderCursorAt(selectionStart: number) {
    this._renderCursor(
      this.canvas!.contextTop,
      this._getCursorBoundaries(selectionStart, true),
      selectionStart,
    );
  }

  /**
   * Renders cursor
   * @param {Object} boundaries
   * @param {CanvasRenderingContext2D} ctx transformed context to draw on
   */
  renderCursor(ctx: CanvasRenderingContext2D, boundaries: CursorBoundaries) {
    this._renderCursor(ctx, boundaries, this.selectionStart);
  }

  /**
   * Return the data needed to render the cursor for given selection start
   * The left,top are relative to the object, while width and height are prescaled
   * to look think with canvas zoom and object scaling,
   * so they depend on canvas and object scaling
   */
  getCursorRenderingData(
    selectionStart: number = this.selectionStart,
    boundaries: CursorBoundaries = this._getCursorBoundaries(selectionStart),
  ): CursorRenderingData {
    const cursorLocation = this.get2DCursorLocation(selectionStart),
      lineIndex = cursorLocation.lineIndex,
      charIndex =
        cursorLocation.charIndex > 0 ? cursorLocation.charIndex - 1 : 0,
      charHeight = this.getValueOfPropertyAt(lineIndex, charIndex, 'fontSize'),
      multiplier = this.getObjectScaling().x * this.canvas!.getZoom(),
      cursorWidth = this.cursorWidth / multiplier,
      dy = this.getValueOfPropertyAt(lineIndex, charIndex, 'deltaY'),
      topOffset =
        boundaries.topOffset +
        ((1 - this._fontSizeFraction) * this.getHeightOfLine(lineIndex)) /
        this.lineHeight -
        charHeight * (1 - this._fontSizeFraction);

    return {
      color:
        this.cursorColor ||
        (this.getValueOfPropertyAt(lineIndex, charIndex, 'fill') as string),
      opacity: this._currentCursorOpacity,
      left: boundaries.left + boundaries.leftOffset - cursorWidth / 2,
      top: topOffset + boundaries.top + dy,
      width: cursorWidth,
      height: charHeight,
    };
  }

  /**
   * Render the cursor at the given selectionStart.
   * @param {CanvasRenderingContext2D} ctx transformed context to draw on
   */
  _renderCursor(
    ctx: CanvasRenderingContext2D,
    boundaries: CursorBoundaries,
    selectionStart: number,
  ) {
    const { color, opacity, left, top, width, height } =
      this.getCursorRenderingData(selectionStart, boundaries);
    ctx.fillStyle = color;
    ctx.globalAlpha = opacity;
    ctx.fillRect(left, top, width, height);
  }

  /**
   * Renders text selection
   * @param {Object} boundaries Object with left/top/leftOffset/topOffset
   * @param {CanvasRenderingContext2D} ctx transformed context to draw on
   */
  renderSelection(ctx: CanvasRenderingContext2D, boundaries: CursorBoundaries) {
    const selection = {
      selectionStart: this.inCompositionMode
        ? this.hiddenTextarea!.selectionStart
        : this.selectionStart,
      selectionEnd: this.inCompositionMode
        ? this.hiddenTextarea!.selectionEnd
        : this.selectionEnd,
    };
    this._renderSelection(ctx, selection, boundaries);
  }

  /**
   * Renders drag start text selection
   */
  renderDragSourceEffect() {
    const dragStartSelection =
      this.draggableTextDelegate.getDragStartSelection()!;
    this._renderSelection(
      this.canvas!.contextTop,
      dragStartSelection,
      this._getCursorBoundaries(dragStartSelection.selectionStart, true),
    );
  }

  renderDropTargetEffect(e: DragEvent) {
    const dragSelection = this.getSelectionStartFromPointer(e);
    this.renderCursorAt(dragSelection);
  }

  /**
   * Renders text selection using visual positions for BiDi support
   * Handles kashida by converting original indices to display indices
   * @private
   * @param {{ selectionStart: number, selectionEnd: number }} selection (in original text space)
   * @param {Object} boundaries Object with left/top/leftOffset/topOffset
   * @param {CanvasRenderingContext2D} ctx transformed context to draw on
   */
  _renderSelection(
    ctx: CanvasRenderingContext2D,
    selection: { selectionStart: number; selectionEnd: number },
    boundaries: CursorBoundaries,
  ) {
    const selectionStart = selection.selectionStart,
      selectionEnd = selection.selectionEnd,
      isJustify = this.textAlign.includes(JUSTIFY);

    // Convert selection indices to line/char using original text space
    // This handles kashida properly since selection indices don't include tatweels
    let startLine = 0, endLine = 0;
    let originalStartChar = selectionStart, originalEndChar = selectionEnd;

    // Find start line and char
    let charCount = 0;
    for (let i = 0; i < this._textLines.length; i++) {
      const originalLineLength = this._getOriginalLineLength(i);
      if (charCount + originalLineLength >= selectionStart) {
        startLine = i;
        originalStartChar = selectionStart - charCount;
        break;
      }
      charCount += originalLineLength + this.missingNewlineOffset(i);
    }

    // Find end line and char
    charCount = 0;
    for (let i = 0; i < this._textLines.length; i++) {
      const originalLineLength = this._getOriginalLineLength(i);
      if (charCount + originalLineLength >= selectionEnd) {
        endLine = i;
        originalEndChar = selectionEnd - charCount;
        break;
      }
      charCount += originalLineLength + this.missingNewlineOffset(i);
      if (i === this._textLines.length - 1) {
        endLine = i;
        originalEndChar = originalLineLength;
      }
    }

    for (let i = startLine; i <= endLine; i++) {
      let lineHeight = this.getHeightOfLine(i),
        realLineHeight = 0;

      // Get visual positions for this line
      const lineText = this._textLines[i].join('');
      const visualPositions = this._measureVisualPositions(i, lineText);
      const displayLineLength = this._textLines[i].length;
      const originalLineLength = this._getOriginalLineLength(i);

      // Calculate selection bounds in original space, then convert to display
      let originalLineStartChar = 0;
      let originalLineEndChar = originalLineLength;

      if (i === startLine) {
        originalLineStartChar = originalStartChar;
      }
      if (i === endLine) {
        originalLineEndChar = originalEndChar;
      }

      // Convert original char indices to display indices for visual lookup
      const displayLineStartChar = this._originalToDisplayIndex(i, originalLineStartChar);
      const displayLineEndChar = this._originalToDisplayIndex(i, originalLineEndChar);

      // Get visual X positions for selection range
      let minVisualX = Infinity;
      let maxVisualX = -Infinity;

      for (const pos of visualPositions) {
        if (pos.logicalIndex >= displayLineStartChar && pos.logicalIndex < displayLineEndChar) {
          minVisualX = Math.min(minVisualX, pos.visualX);
          maxVisualX = Math.max(maxVisualX, pos.visualX + pos.width);
        }
      }

      // Handle edge cases
      if (minVisualX === Infinity || maxVisualX === -Infinity) {
        if (i >= startLine && i < endLine) {
          // Full line selection
          minVisualX = 0;
          maxVisualX = isJustify && !this.isEndOfWrapping(i)
            ? this.width
            : this.getLineWidth(i) || 5;
        } else {
          continue; // No selection on this line
        }
      }

      realLineHeight = lineHeight;
      if (this.lineHeight < 1 || (i === endLine && this.lineHeight > 1)) {
        lineHeight /= this.lineHeight;
      }

      // Calculate draw position
      // Visual positions are relative to line start (0 to lineWidth)
      // Need to add alignment offset
      const lineWidth = this.getLineWidth(i);
      let alignOffset = 0;

      if (this.textAlign === 'center' || this.textAlign === 'justify-center') {
        alignOffset = (this.width - lineWidth) / 2;
      } else if (this.textAlign === 'right' || this.textAlign === 'justify-right') {
        alignOffset = this.width - lineWidth;
      } else if (this.direction === 'rtl' && (this.textAlign === 'justify' || this.textAlign === 'left')) {
        alignOffset = this.width - lineWidth;
      }

      // Draw from center origin (-width/2 to width/2)
      const drawStart = -this.width / 2 + alignOffset + minVisualX;
      const drawWidth = maxVisualX - minVisualX;
      let drawHeight = lineHeight;
      let extraTop = 0;

      if (this.inCompositionMode) {
        ctx.fillStyle = this.compositionColor || 'black';
        drawHeight = 1;
        extraTop = lineHeight;
      } else {
        ctx.fillStyle = this.selectionColor;
      }

      ctx.fillRect(
        drawStart,
        boundaries.top + boundaries.topOffset + extraTop,
        drawWidth,
        drawHeight,
      );
      boundaries.topOffset += realLineHeight;
    }
  }

  /**
   * High level function to know the height of the cursor.
   * the currentChar is the one that precedes the cursor
   * Returns fontSize of char at the current cursor
   * Unused from the library, is for the end user
   * @return {Number} Character font size
   */
  getCurrentCharFontSize(): number {
    const cp = this._getCurrentCharIndex();
    return this.getValueOfPropertyAt(cp.l, cp.c, 'fontSize');
  }

  /**
   * High level function to know the color of the cursor.
   * the currentChar is the one that precedes the cursor
   * Returns color (fill) of char at the current cursor
   * if the text object has a pattern or gradient for filler, it will return that.
   * Unused by the library, is for the end user
   * @return {String | TFiller} Character color (fill)
   */
  getCurrentCharColor(): string | TFiller | null {
    const cp = this._getCurrentCharIndex();
    return this.getValueOfPropertyAt(cp.l, cp.c, FILL);
  }

  /**
   * Returns the cursor position for the getCurrent.. functions
   * @private
   */
  _getCurrentCharIndex() {
    const cursorPosition = this.get2DCursorLocation(this.selectionStart, true),
      charIndex =
        cursorPosition.charIndex > 0 ? cursorPosition.charIndex - 1 : 0;
    return { l: cursorPosition.lineIndex, c: charIndex };
  }

  dispose() {
    this.exitEditingImpl();
    this.draggableTextDelegate.dispose();
    super.dispose();
  }
}

classRegistry.setClass(IText);
// legacy
classRegistry.setClass(IText, 'i-text');
