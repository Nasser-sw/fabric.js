import type { TClassProperties, TOptions } from '../typedefs';
import { IText } from './IText/IText';
import { classRegistry } from '../ClassRegistry';
import { createTextboxDefaultControls } from '../controls/commonControls';
import { JUSTIFY, JUSTIFY_CENTER } from './Text/constants';
import type { TextStyleDeclaration } from './Text/StyledText';
import type { SerializedITextProps, ITextProps } from './IText/IText';
import type { ITextEvents } from './IText/ITextBehavior';
import type { TextLinesInfo } from './Text/Text';
import type { Control } from '../controls/Control';
import { fontLacksEnglishGlyphsCached } from '../text/measure';
import { layoutText } from '../text/layout';
import { findKashidaPoints, ARABIC_TATWEEL } from '../text/unicode';

// @TODO: Many things here are configuration related and shouldn't be on the class nor prototype
// regexes, list of properties that are not suppose to change by instances, magic consts.
// this will be a separated effort
export const textboxDefaultValues: Partial<TClassProperties<Textbox>> = {
  minWidth: 20,
  dynamicMinWidth: 2,
  lockScalingFlip: true,
  noScaleCache: false,
  _wordJoiners: /[ \t\r]/,
  splitByGrapheme: false,
};

export type GraphemeData = {
  wordsData: {
    word: string[];
    width: number;
  }[][];
  largestWordWidth: number;
};

export type StyleMap = Record<string, { line: number; offset: number }>;

// @TODO this is not complete
interface UniqueTextboxProps {
  minWidth: number;
  splitByGrapheme: boolean;
  dynamicMinWidth: number;
  _wordJoiners: RegExp;
}

export interface SerializedTextboxProps
  extends SerializedITextProps,
    Pick<UniqueTextboxProps, 'minWidth' | 'splitByGrapheme'> {}

export interface TextboxProps extends ITextProps, UniqueTextboxProps {}

/**
 * Textbox class, based on IText, allows the user to resize the text rectangle
 * and wraps lines automatically. Textboxes have their Y scaling locked, the
 * user can only change width. Height is adjusted automatically based on the
 * wrapping of lines.
 */
export class Textbox<
    Props extends TOptions<TextboxProps> = Partial<TextboxProps>,
    SProps extends SerializedTextboxProps = SerializedTextboxProps,
    EventSpec extends ITextEvents = ITextEvents,
  >
  extends IText<Props, SProps, EventSpec>
  implements UniqueTextboxProps
{
  /**
   * Minimum width of textbox, in pixels.
   * @type Number
   */
  declare minWidth: number;

  /**
   * Minimum calculated width of a textbox, in pixels.
   * fixed to 2 so that an empty textbox cannot go to 0
   * and is still selectable without text.
   * @type Number
   */
  declare dynamicMinWidth: number;
  /**
   * When true, prevent dynamicMinWidth updates during layout (used to keep width stable on commit).
   */
  declare lockDynamicMinWidth?: boolean;

  /**
   * Use this boolean property in order to split strings that have no white space concept.
   * this is a cheap way to help with chinese/japanese
   * @type Boolean
   * @since 2.6.0
   */
  declare splitByGrapheme: boolean;

  declare _wordJoiners: RegExp;

  declare _styleMap: StyleMap;

  declare isWrapping: boolean;

  static type = 'Textbox';

  static textLayoutProperties = [...IText.textLayoutProperties, 'width'];

  static ownDefaults = textboxDefaultValues;

  static getDefaults(): Record<string, any> {
    return {
      ...super.getDefaults(),
      ...Textbox.ownDefaults,
    };
  }

  /**
   * Constructor
   * @param {String} text Text string
   * @param {Object} [options] Options object
   */
  constructor(text: string, options?: Props) {
    super(text, { ...Textbox.ownDefaults, ...options } as Props);
    this.initializeEventListeners();
  }

  /**
   * Creates the default control object.
   * If you prefer to have on instance of controls shared among all objects
   * make this function return an empty object and add controls to the ownDefaults object
   */
  static createControls(): { controls: Record<string, Control> } {
    return { controls: createTextboxDefaultControls() };
  }

  /**
   * Unlike superclass's version of this function, Textbox does not update
   * its width.
   * @private
   * @override
   */
  initDimensions() {
    if (!this.initialized) {
      this.initialized = true;
    }

    // Skip if nothing changed
    const currentState = `${this.text}|${this.width}|${this.fontSize}|${this.fontFamily}|${this.textAlign}|${this.kashida}`;
    if (
      (this as any)._lastDimensionState === currentState &&
      this._textLines &&
      this._textLines.length > 0
    ) {
      return;
    }
    (this as any)._lastDimensionState = currentState;

    // Use advanced layout if enabled
    if (this.enableAdvancedLayout) {
      return this.initDimensionsAdvanced();
    }

    this.isEditing && this.initDelayedCursor();
    this._clearCache();
    this.dynamicMinWidth = 0;

    // Wrap lines
    const splitTextResult = this._splitText();
    this._styleMap = this._generateStyleMap(splitTextResult);

    // For browser wrapping, ensure _textLines is set from browser results
    if (
      (this as any)._usingBrowserWrapping &&
      splitTextResult &&
      splitTextResult.lines
    ) {
      this._textLines = splitTextResult.lines.map((line) => line.split(''));

      const justifyMeasurements = (splitTextResult as any)
        .justifySpaceMeasurements;
      if (justifyMeasurements) {
        (this._styleMap as any).justifySpaceMeasurements = justifyMeasurements;
      }

      const actualHeight = (splitTextResult as any).actualBrowserHeight;
      if (actualHeight) {
        (this as any)._actualBrowserHeight = actualHeight;
      }
    }

    // Update width if dynamicMinWidth exceeds it (for non-browser-wrapping)
    if (!(this as any)._usingBrowserWrapping && this.dynamicMinWidth > this.width) {
      this._set('width', this.dynamicMinWidth);
    }

    // For browser wrapping fonts, ensure minimum width for new textboxes
    if ((this as any)._usingBrowserWrapping && this.width < 50) {
      this.width = 300;
    }

    // Calculate height
    this.height = this.calcTextHeight();

    // Handle justify alignment
    if (this.textAlign.includes(JUSTIFY)) {
      // Force __charBounds to be populated by measuring all lines
      for (let i = 0; i < this._textLines.length; i++) {
        this.getLineWidth(i);
      }

      if ((this as any)._usingBrowserWrapping) {
        this._applyBrowserJustifySpaces();
      } else {
        // Use Fabric's justify system
        if (this.__charBounds && this.__charBounds.length > 0) {
          this.enlargeSpaces();
        }
      }
    }
  }

  /**
   * Schedule justify calculation after font loads (Textbox-specific)
   * @private
   */
  _scheduleJustifyAfterFontLoad(): void {
    if (typeof document === 'undefined' || !('fonts' in document)) {
      return;
    }

    if ((this as any)._fontJustifyScheduled) {
      return;
    }
    (this as any)._fontJustifyScheduled = true;

    const fontSpec = `${this.fontSize}px ${this.fontFamily}`;
    document.fonts
      .load(fontSpec)
      .then(() => {
        (this as any)._fontJustifyScheduled = false;
        this.initDimensions();
        this.canvas?.requestRenderAll();
      })
      .catch(() => {
        (this as any)._fontJustifyScheduled = false;
      });
  }

  /**
   * Advanced dimensions calculation using new layout engine
   * @private
   */
  initDimensionsAdvanced() {
    if (!this.initialized) {
      return;
    }

    this.isEditing && this.initDelayedCursor();
    this._clearCache();

    if (!this.lockDynamicMinWidth) {
      this.dynamicMinWidth = 0;
    }

    // Use new layout engine
    // When kashida is enabled, don't let layout engine apply justify - we'll handle it with kashida
    const useKashidaJustify = this.kashida !== 'none' && this.textAlign.includes(JUSTIFY);
    const effectiveAlign = useKashidaJustify
      ? (this.direction === 'rtl' ? 'right' : 'left')  // Natural alignment, kashida will justify
      : (this as any)._mapTextAlignToAlign(this.textAlign);

    const layout = layoutText({
      text: this.text,
      width: this.width,
      // Don't pass height constraint to allow vertical auto-expansion
      // Only pass height if explicitly set to constrain (e.g., for ellipsis)
      height: this.ellipsis ? this.height : undefined,
      wrap: this.wrap || 'word',
      align: effectiveAlign,
      ellipsis: this.ellipsis || false,
      fontSize: this.fontSize,
      lineHeight: this.lineHeight,
      letterSpacing: this.letterSpacing || 0,
      charSpacing: this.charSpacing,
      direction: this.direction === 'inherit' ? 'ltr' : this.direction,
      fontFamily: this.fontFamily,
      fontStyle: this.fontStyle,
      fontWeight: this.fontWeight,
      verticalAlign: this.verticalAlign || 'top',
    });

    // Update dynamic minimum width based on layout (unless explicitly locked)
    if (!this.lockDynamicMinWidth) {
      if (layout.lines.length > 0) {
        const maxLineWidth = Math.max(...layout.lines.map((line) => line.width));
        this.dynamicMinWidth = Math.max(this.minWidth, maxLineWidth);
      }

      if (this.dynamicMinWidth > this.width) {
        this._set('width', this.dynamicMinWidth);
        const newLayout = layoutText({
          ...(this as any)._getAdvancedLayoutOptions(),
          width: this.width,
        });
        this.height = newLayout.totalHeight;
        (this as any)._convertLayoutToLegacyFormat(newLayout);
      } else {
        this.height = layout.totalHeight;
        (this as any)._convertLayoutToLegacyFormat(layout);
      }
    } else {
      this.height = layout.totalHeight;
      (this as any)._convertLayoutToLegacyFormat(layout);
    }

    // Generate style map for compatibility
    this._styleMap = this._generateStyleMapFromLayout(layout);

    // Apply kashida for justified text in advanced layout mode
    if (this.textAlign.includes(JUSTIFY) && this.kashida !== 'none') {
      this._applyKashidaToLayout();
    }

    this.dirty = true;
  }

  /**
   * Apply kashida (tatweel) characters to layout for Arabic text justification.
   * This method INSERTS actual tatweel characters into the text lines.
   * @private
   */
  _applyKashidaToLayout() {
    if (!this._textLines || !this.__charBounds) {
      return;
    }

    // Clear visual positions cache - it becomes stale when kashida is applied
    // Check if cache exists (it's initialized in IText constructor which runs after this during construction)
    if ((this as any)._visualPositionsCache) {
      this._clearVisualPositionsCache();
    }

    const kashidaRatios: Record<string, number> = {
      none: 0,
      short: 0.25,
      medium: 0.5,
      long: 0.75,
      stylistic: 1.0,
    };
    const kashidaRatio = kashidaRatios[this.kashida] || 0;

    if (kashidaRatio === 0) {
      return;
    }

    // Calculate tatweel width once
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    ctx.font = this._getFontDeclaration();
    const tatweelWidth = ctx.measureText(ARABIC_TATWEEL).width;

    if (tatweelWidth <= 0) {
      return;
    }

    // Reset kashida info
    this.__kashidaInfo = [];

    const totalLines = this._textLines.length;

    for (let lineIndex = 0; lineIndex < totalLines; lineIndex++) {
      this.__kashidaInfo[lineIndex] = [];
      const line = this._textLines[lineIndex];

      if (!this.__charBounds || !this.__charBounds[lineIndex]) {
        continue;
      }

      // Don't apply kashida to the last line
      const isLastLine = lineIndex === totalLines - 1;
      if (isLastLine) {
        continue;
      }

      const lineBounds = this.__charBounds[lineIndex];
      const lastBound = lineBounds[lineBounds.length - 1];

      // Calculate current line width
      const currentLineWidth = lastBound ? (lastBound.left + lastBound.kernedWidth) : 0;
      const totalExtraSpace = this.width - currentLineWidth;

      // Only apply kashida if there's significant extra space to fill
      if (totalExtraSpace <= 2) {
        continue;
      }

      // Find kashida points
      const kashidaPoints = findKashidaPoints(line);
      if (kashidaPoints.length === 0) {
        continue;
      }

      // Calculate kashida space
      const kashidaSpace = totalExtraSpace * kashidaRatio;

      // Calculate how many tatweels can fit
      const totalTatweels = Math.floor(kashidaSpace / tatweelWidth);
      if (totalTatweels === 0) {
        continue;
      }

      // Limit kashida points
      const maxKashidaPoints = Math.min(kashidaPoints.length, totalTatweels);
      const usedKashidaPoints = kashidaPoints.slice(0, maxKashidaPoints);

      // Distribute tatweels evenly
      const tatweelsPerPoint = Math.floor(totalTatweels / maxKashidaPoints);
      const extraTatweels = totalTatweels % maxKashidaPoints;

      // console.log(`=== Inserting Kashida into line ${lineIndex} ===`);
      // console.log(`  totalTatweels: ${totalTatweels}, usedPoints: ${usedKashidaPoints.length}`);

      // Sort by charIndex descending so we insert from the end (prevents index shifting issues)
      const sortedPoints = [...usedKashidaPoints].sort((a, b) => b.charIndex - a.charIndex);

      // Create new line with tatweels inserted
      const newLine = [...line];
      for (let i = 0; i < sortedPoints.length; i++) {
        const point = sortedPoints[i];
        const originalIndex = usedKashidaPoints.indexOf(point);
        const count = tatweelsPerPoint + (originalIndex < extraTatweels ? 1 : 0);

        if (count > 0) {
          // Insert tatweels AFTER the character at charIndex
          const tatweels = Array(count).fill(ARABIC_TATWEEL);
          newLine.splice(point.charIndex + 1, 0, ...tatweels);
          // console.log(`  Inserted ${count} tatweels after char ${point.charIndex}`);

          // Store kashida info for index conversion
          this.__kashidaInfo[lineIndex].push({
            charIndex: point.charIndex,
            width: count * tatweelWidth,
            tatweelCount: count,
          });
        }
      }

      // Update _textLines with the new line containing tatweels
      this._textLines[lineIndex] = newLine;

      // Update textLines (string version)
      if (this.textLines) {
        (this as any).textLines[lineIndex] = newLine.join('');
      }

      // Clear and recalculate charBounds for this line
      this.__charBounds[lineIndex] = [];
      this.__lineWidths[lineIndex] = undefined as any;
      this._measureLine(lineIndex);

      // Now expand spaces to fill any remaining gap
      let newLineBounds = this.__charBounds[lineIndex];
      if (newLineBounds && newLineBounds.length > 0) {
        let newLastBound = newLineBounds[newLineBounds.length - 1];
        let newLineWidth = newLastBound ? (newLastBound.left + newLastBound.kernedWidth) : 0;
        let remainingGap = this.width - newLineWidth;

        if (remainingGap > 0.5) {
          // Count spaces in the new line
          let spaceCount = 0;
          for (let i = 0; i < newLine.length; i++) {
            if (/\s/.test(newLine[i])) {
              spaceCount++;
            }
          }

          if (spaceCount > 0) {
            const extraPerSpace = remainingGap / spaceCount;
            let accumulatedExtra = 0;

            // Expand space widths AND update left positions for subsequent chars
            for (let i = 0; i < newLineBounds.length; i++) {
              const bound = newLineBounds[i];
              if (!bound) continue;

              // Update left position to account for previous space expansions
              bound.left += accumulatedExtra;

              // If this is a space, expand it
              if (/\s/.test(newLine[i])) {
                bound.width += extraPerSpace;
                bound.kernedWidth += extraPerSpace;
                accumulatedExtra += extraPerSpace;
              }
            }
            // Update the extra entry at the end (cursor position)
            if (newLineBounds[newLine.length]) {
              newLineBounds[newLine.length].left += accumulatedExtra;
            }

            // Recalculate remaining gap after space expansion
            newLastBound = newLineBounds[newLineBounds.length - 1];
            newLineWidth = newLastBound ? (newLastBound.left + newLastBound.kernedWidth) : 0;
            remainingGap = this.width - newLineWidth;
          }
        }

        // If there's still a gap after space expansion, distribute it across all kashida points
        if (remainingGap > 0.5 && this.__kashidaInfo[lineIndex].length > 0) {
          const kashidaPointCount = this.__kashidaInfo[lineIndex].length;
          const extraPerKashida = remainingGap / kashidaPointCount;

          // Find kashida positions in newLine and expand their widths
          let kashidaIndex = 0;
          let accumulatedExtra = 0;

          for (let i = 0; i < newLineBounds.length; i++) {
            const bound = newLineBounds[i];
            if (!bound) continue;

            // Update left position for accumulated expansion
            bound.left += accumulatedExtra;

            // Check if this is a tatweel character
            if (newLine[i] === ARABIC_TATWEEL) {
              // Distribute extra width among tatweels
              const extraForThis = extraPerKashida / (this.__kashidaInfo[lineIndex][kashidaIndex]?.tatweelCount || 1);
              bound.width += extraForThis;
              bound.kernedWidth += extraForThis;
              accumulatedExtra += extraForThis;

              // Move to next kashida info when we've passed this group
              const currentKashidaInfo = this.__kashidaInfo[lineIndex][kashidaIndex];
              if (currentKashidaInfo && i > 0) {
                // Check if next char is not tatweel - means we're done with this group
                if (i + 1 >= newLine.length || newLine[i + 1] !== ARABIC_TATWEEL) {
                  kashidaIndex++;
                }
              }
            }
          }

          // Update the extra entry at the end
          if (newLineBounds[newLine.length]) {
            newLineBounds[newLine.length].left += accumulatedExtra;
          }
        }
      }

      // Set line width to textbox width (for justified lines)
      this.__lineWidths[lineIndex] = this.width;

      // console.log(`  New line length: ${newLine.length}, text: ${newLine.join('')}`);
    }

    // For justified lines with kashida, line width should equal textbox width
    // Only set undefined widths (non-justified lines without kashida)
    for (let i = 0; i < this._textLines.length; i++) {
      if (this.__lineWidths[i] === undefined && this.__charBounds[i]) {
        const bounds = this.__charBounds[i];
        const lastBound = bounds[bounds.length - 1];
        if (lastBound) {
          this.__lineWidths[i] = lastBound.left + lastBound.kernedWidth;
        }
      }
    }

    // Update _text to match the new _textLines (required for editing)
    this._text = this._textLines.flat();

    // DON'T update this.text - keep the original text intact
    // The tatweels are in _textLines and _text for rendering purposes only

    (this as any)._justifyApplied = true;

    // Debug log final kashida state
    // console.log('=== _applyKashidaToLayout END ===');
    // console.log('Final __kashidaInfo:', JSON.stringify(this.__kashidaInfo.map((lineInfo, i) => ({
    //   line: i,
    //   entries: lineInfo.map(k => ({ charIndex: k.charIndex, tatweelCount: k.tatweelCount }))
    // }))));
  }

  /**
   * Generate style map from new layout format
   * @private
   */
  _generateStyleMapFromLayout(layout: any): StyleMap {
    const map: StyleMap = {};
    let realLineCount = 0;
    let charCount = 0;

    layout.lines.forEach((line: any, i: number) => {
      if (line.text.includes('\n') && i > 0) {
        realLineCount++;
      }
      
      map[i] = { line: realLineCount, offset: 0 };
      charCount += line.graphemes.length;
      
      if (i < layout.lines.length - 1) {
        charCount += 1; // newline character
      }
    });

    return map;
  }

  /**
   * Generate an object that translates the style object so that it is
   * broken up by visual lines (new lines and automatic wrapping).
   * The original text styles object is broken up by actual lines (new lines only),
   * which is only sufficient for Text / IText
   * @private
   */
  _generateStyleMap(textInfo: TextLinesInfo): StyleMap {
    let realLineCount = 0,
      realLineCharCount = 0,
      charCount = 0;
    const map: StyleMap = {};

    for (let i = 0; i < textInfo.graphemeLines.length; i++) {
      if (textInfo.graphemeText[charCount] === '\n' && i > 0) {
        realLineCharCount = 0;
        charCount++;
        realLineCount++;
      } else if (
        !this.splitByGrapheme &&
        this._reSpaceAndTab.test(textInfo.graphemeText[charCount]) &&
        i > 0
      ) {
        // this case deals with space's that are removed from end of lines when wrapping
        realLineCharCount++;
        charCount++;
      }

      map[i] = { line: realLineCount, offset: realLineCharCount };

      charCount += textInfo.graphemeLines[i].length;
      realLineCharCount += textInfo.graphemeLines[i].length;
    }

    return map;
  }

  /**
   * Returns true if object has a style property or has it on a specified line
   * @param {Number} lineIndex
   * @return {Boolean}
   */
  styleHas(property: keyof TextStyleDeclaration, lineIndex: number): boolean {
    if (this._styleMap && !this.isWrapping) {
      const map = this._styleMap[lineIndex];
      if (map) {
        lineIndex = map.line;
      }
    }
    return super.styleHas(property, lineIndex);
  }

  /**
   * Returns true if object has no styling or no styling in a line
   * @param {Number} lineIndex , lineIndex is on wrapped lines.
   * @return {Boolean}
   */
  isEmptyStyles(lineIndex: number): boolean {
    if (!this.styles) {
      return true;
    }
    let offset = 0,
      nextLineIndex = lineIndex + 1,
      nextOffset: number,
      shouldLimit = false;
    const map = this._styleMap[lineIndex],
      mapNextLine = this._styleMap[lineIndex + 1];
    if (map) {
      lineIndex = map.line;
      offset = map.offset;
    }
    if (mapNextLine) {
      nextLineIndex = mapNextLine.line;
      shouldLimit = nextLineIndex === lineIndex;
      nextOffset = mapNextLine.offset;
    }
    const obj =
      typeof lineIndex === 'undefined'
        ? this.styles
        : { line: this.styles[lineIndex] };
    for (const p1 in obj) {
      for (const p2 in obj[p1]) {
        const p2Number = parseInt(p2, 10);
        if (p2Number >= offset && (!shouldLimit || p2Number < nextOffset!)) {
          for (const p3 in obj[p1][p2]) {
            return false;
          }
        }
      }
    }
    return true;
  }

  /**
   * @protected
   * @param {Number} lineIndex
   * @param {Number} charIndex
   * @return {TextStyleDeclaration} a style object reference to the existing one or a new empty object when undefined
   */
  _getStyleDeclaration(
    lineIndex: number,
    charIndex: number,
  ): TextStyleDeclaration {
    if (this._styleMap && !this.isWrapping) {
      const map = this._styleMap[lineIndex];
      if (!map) {
        return {};
      }
      lineIndex = map.line;
      charIndex = map.offset + charIndex;
    }
    return super._getStyleDeclaration(lineIndex, charIndex);
  }

  /**
   * @param {Number} lineIndex
   * @param {Number} charIndex
   * @param {Object} style
   * @private
   */
  protected _setStyleDeclaration(
    lineIndex: number,
    charIndex: number,
    style: object,
  ) {
    const map = this._styleMap[lineIndex];
    super._setStyleDeclaration(map.line, map.offset + charIndex, style);
  }

  /**
   * @param {Number} lineIndex
   * @param {Number} charIndex
   * @private
   */
  protected _deleteStyleDeclaration(lineIndex: number, charIndex: number) {
    const map = this._styleMap[lineIndex];
    super._deleteStyleDeclaration(map.line, map.offset + charIndex);
  }

  /**
   * probably broken need a fix
   * Returns the real style line that correspond to the wrapped lineIndex line
   * Used just to verify if the line does exist or not.
   * @param {Number} lineIndex
   * @returns {Boolean} if the line exists or not
   * @private
   */
  protected _getLineStyle(lineIndex: number): boolean {
    const map = this._styleMap[lineIndex];
    return !!this.styles[map.line];
  }

  /**
   * Set the line style to an empty object so that is initialized
   * @param {Number} lineIndex
   * @param {Object} style
   * @private
   */
  protected _setLineStyle(lineIndex: number) {
    const map = this._styleMap[lineIndex];
    super._setLineStyle(map.line);
  }

  /**
   * Wraps text using the 'width' property of Textbox. First this function
   * splits text on newlines, so we preserve newlines entered by the user.
   * Then it wraps each line using the width of the Textbox by calling
   * _wrapLine().
   * @param {Array} lines The string array of text that is split into lines
   * @param {Number} desiredWidth width you want to wrap to
   * @returns {Array} Array of lines
   */
  _wrapText(lines: string[], desiredWidth: number): string[][] {
    this.isWrapping = true;
    // extract all thewords and the widths to optimally wrap lines.
    const data = this.getGraphemeDataForRender(lines);
    const wrapped: string[][] = [];
    for (let i = 0; i < data.wordsData.length; i++) {
      wrapped.push(...this._wrapLine(i, desiredWidth, data));
    }
    this.isWrapping = false;
    return wrapped;
  }

  /**
   * For each line of text terminated by an hard line stop,
   * measure each word width and extract the largest word from all.
   * The returned words here are the one that at the end will be rendered.
   * @param {string[]} lines the lines we need to measure
   *
   */
  getGraphemeDataForRender(lines: string[]): GraphemeData {
    const splitByGrapheme = this.splitByGrapheme,
      infix = splitByGrapheme ? '' : ' ';

    let largestWordWidth = 0;

    const data = lines.map((line, lineIndex) => {
      let offset = 0;
      const wordsOrGraphemes = splitByGrapheme
        ? this.graphemeSplit(line)
        : this.wordSplit(line);

      if (wordsOrGraphemes.length === 0) {
        return [{ word: [], width: 0 }];
      }

      return wordsOrGraphemes.map((word: string) => {
        // if using splitByGrapheme words are already in graphemes.
        const graphemeArray = splitByGrapheme
          ? [word]
          : this.graphemeSplit(word);
        const width = this._measureWord(graphemeArray, lineIndex, offset);
        largestWordWidth = Math.max(width, largestWordWidth);
        offset += graphemeArray.length + infix.length;
        return { word: graphemeArray, width };
      });
    });

    return {
      wordsData: data,
      largestWordWidth,
    };
  }

  /**
   * Helper function to measure a string of text, given its lineIndex and charIndex offset
   * It gets called when charBounds are not available yet.
   * Override if necessary
   * Use with {@link Textbox#wordSplit}
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {String} text
   * @param {number} lineIndex
   * @param {number} charOffset
   * @returns {number}
   */
  _measureWord(word: string[], lineIndex: number, charOffset = 0): number {
    let width = 0,
      prevGrapheme;
    const skipLeft = true;
    for (let i = 0, len = word.length; i < len; i++) {
      const box = this._getGraphemeBox(
        word[i],
        lineIndex,
        i + charOffset,
        prevGrapheme,
        skipLeft,
      );
      width += box.kernedWidth;
      prevGrapheme = word[i];
    }
    return width;
  }

  /**
   * Override this method to customize word splitting
   * Use with {@link Textbox#_measureWord}
   * @param {string} value
   * @returns {string[]} array of words
   */
  wordSplit(value: string): string[] {
    return value.split(this._wordJoiners);
  }

  /**
   * Wraps a line of text using the width of the Textbox as desiredWidth
   * and leveraging the known width o words from GraphemeData
   * @private
   * @param {Number} lineIndex
   * @param {Number} desiredWidth width you want to wrap the line to
   * @param {GraphemeData} graphemeData an object containing all the lines' words width.
   * @param {Number} reservedSpace space to remove from wrapping for custom functionalities
   * @returns {Array} Array of line(s) into which the given text is wrapped
   * to.
   */
  _wrapLine(
    lineIndex: number,
    desiredWidth: number,
    { largestWordWidth, wordsData }: GraphemeData,
    reservedSpace = 0,
  ): string[][] {
    const additionalSpace = this._getWidthOfCharSpacing(),
      splitByGrapheme = this.splitByGrapheme,
      graphemeLines = [],
      infix = splitByGrapheme ? '' : ' ';

    let lineWidth = 0,
      line: string[] = [],
      // spaces in different languages?
      offset = 0,
      infixWidth = 0,
      lineJustStarted = true;

    desiredWidth -= reservedSpace;

    const maxWidth = Math.max(desiredWidth, largestWordWidth, this.dynamicMinWidth);

    // Layout words
    const data = wordsData[lineIndex];
    offset = 0;
    let i;
    for (i = 0; i < data.length; i++) {
      const { word, width: wordWidth } = data[i];
      offset += word.length;

      const potentialLineWidth =
        lineWidth + infixWidth + wordWidth - additionalSpace;

      if (potentialLineWidth > maxWidth && !lineJustStarted) {
        graphemeLines.push(line);
        line = [];
        lineWidth = wordWidth;
        lineJustStarted = true;
      } else {
        lineWidth = potentialLineWidth + additionalSpace;
      }

      if (!lineJustStarted && !splitByGrapheme) {
        line.push(infix);
      }
      line = line.concat(word);

      infixWidth = splitByGrapheme
        ? 0
        : this._measureWord([infix], lineIndex, offset);
      offset++;
      lineJustStarted = false;
    }

    i && graphemeLines.push(line);

    if (
      !(this as any)._usingBrowserWrapping &&
      largestWordWidth + reservedSpace > this.dynamicMinWidth
    ) {
      this.dynamicMinWidth = largestWordWidth - additionalSpace + reservedSpace;
    }

    return graphemeLines;
  }

  /**
   * Detect if the text line is ended with an hard break
   * text and itext do not have wrapping, return false
   * @param {Number} lineIndex text to split
   * @return {Boolean}
   */
  isEndOfWrapping(lineIndex: number): boolean {
    if (!this._styleMap[lineIndex + 1]) {
      // is last line, return true;
      return true;
    }
    if (this._styleMap[lineIndex + 1].line !== this._styleMap[lineIndex].line) {
      // this is last line before a line break, return true;
      return true;
    }
    return false;
  }

  /**
   * Detect if a line has a linebreak and so we need to account for it when moving
   * and counting style.
   * This is important only for splitByGrapheme at the end of wrapping.
   * If we are not wrapping the offset is always 1
   * @return Number
   */
  missingNewlineOffset(lineIndex: number, skipWrapping?: boolean): 0 | 1 {
    if (this.splitByGrapheme && !skipWrapping) {
      return this.isEndOfWrapping(lineIndex) ? 1 : 0;
    }
    return 1;
  }

  /**
   * Gets lines of text to render in the Textbox. This function calculates
   * text wrapping on the fly every time it is called.
   * @param {String} text text to split
   * @returns {Array} Array of lines in the Textbox.
   * @override
   */
  _splitTextIntoLines(text: string) {
    // Check if we need browser wrapping using smart font detection
    const needsBrowserWrapping = this.fontFamily && fontLacksEnglishGlyphsCached(this.fontFamily);
    
    if (needsBrowserWrapping) {
      // Cache key based on text content, width, font properties, AND text alignment
      const textHash = text.length + text.slice(0, 50); // Include text content in cache key
      const cacheKey = `${textHash}|${this.width}|${this.fontSize}|${this.fontFamily}|${this.textAlign}`;
      
      // Check if we have a cached result and nothing has changed
      if ((this as any)._browserWrapCache && (this as any)._browserWrapCache.key === cacheKey) {
        const cachedResult = (this as any)._browserWrapCache.result;
        
        // For justify alignment, ensure we have the measurements
        if (this.textAlign.includes('justify') && !(cachedResult as any).justifySpaceMeasurements) {
          // Fall through to recalculate
        } else {
          return cachedResult;
        }
      }
      
      const result = this._splitTextIntoLinesWithBrowser(text);
      
      // Cache the result
      (this as any)._browserWrapCache = { key: cacheKey, result };
      
      // Mark that we used browser wrapping to prevent dynamicMinWidth modifications
      (this as any)._usingBrowserWrapping = true;
      
      return result;
    }
    
    // Clear the browser wrapping flag when using regular wrapping
    (this as any)._usingBrowserWrapping = false;
    
    // Default Fabric wrapping for other fonts
    const newText = super._splitTextIntoLines(text),
      graphemeLines = this._wrapText(newText.lines, this.width),
      lines = new Array(graphemeLines.length);
    for (let i = 0; i < graphemeLines.length; i++) {
      lines[i] = graphemeLines[i].join('');
    }
    newText.lines = lines;
    newText.graphemeLines = graphemeLines;
    return newText;
  }

  /**
   * Use browser's native text wrapping for accurate handling of fonts without English glyphs
   * @private
   */
  _splitTextIntoLinesWithBrowser(text: string) {
    if (typeof document === 'undefined') {
      // Fallback to regular wrapping in Node.js
      return this._splitTextIntoLinesDefault(text);
    }

    // Create a hidden element that mimics the overlay editor
    const testElement = document.createElement('div');
    testElement.style.position = 'absolute';
    testElement.style.left = '-9999px';
    testElement.style.visibility = 'hidden';
    testElement.style.fontSize = `${this.fontSize}px`;
    testElement.style.fontFamily = `"${this.fontFamily}"`;
    testElement.style.fontWeight = String(this.fontWeight || 'normal');
    testElement.style.fontStyle = String(this.fontStyle || 'normal');
    testElement.style.lineHeight = String(this.lineHeight || 1.16);
    
    testElement.style.width = `${this.width}px`;
    
    testElement.style.direction = this.direction || 'ltr';
    testElement.style.whiteSpace = 'pre-wrap';
    testElement.style.wordBreak = 'normal';
    testElement.style.overflowWrap = 'break-word';
    
    // Set browser-native text alignment (including justify)
    if (this.textAlign.includes('justify')) {
      testElement.style.textAlign = 'justify';
      testElement.style.textAlignLast = 'auto'; // Let browser decide last line alignment
    } else {
      testElement.style.textAlign = this.textAlign;
    }
    
    testElement.textContent = text;

    document.body.appendChild(testElement);

    // Get the browser's natural line breaks
    const range = document.createRange();
    const lines: string[] = [];
    const graphemeLines: string[][] = [];

    try {
      // Simple approach: split by measuring character positions
      const textNode = testElement.firstChild;
      if (textNode && textNode.nodeType === Node.TEXT_NODE) {
        let currentLineStart = 0;
        const textLength = text.length;
        let previousBottom = 0;
        
        for (let i = 0; i <= textLength; i++) {
          range.setStart(textNode, currentLineStart);
          range.setEnd(textNode, i);
          const rect = range.getBoundingClientRect();
          
          if (i > currentLineStart && (rect.bottom > previousBottom + 5 || i === textLength)) {
            // New line detected or end of text
            const lineEnd = i === textLength ? i : i - 1;
            const lineText = text.substring(currentLineStart, lineEnd).trim();
            if (lineText) {
              lines.push(lineText);
              // Convert to graphemes for compatibility
              const graphemeLine = lineText.split('');
              graphemeLines.push(graphemeLine);
                    }
            currentLineStart = lineEnd;
            previousBottom = rect.bottom;
          }
        }
      }
    } catch (error) {
      document.body.removeChild(testElement);
      return this._splitTextIntoLinesDefault(text);
    }

    // Extract actual browser height BEFORE removing element
    const actualBrowserHeight = testElement.scrollHeight;
    const boundingRect = testElement.getBoundingClientRect();

    // For justify alignment, extract space measurements from browser BEFORE removing element
    let justifySpaceMeasurements = null;
    if (this.textAlign.includes('justify')) {
      justifySpaceMeasurements = this._extractJustifySpaceMeasurements(
        testElement,
        lines,
      );
    }

    document.body.removeChild(testElement);

    // Use the larger of scrollHeight or boundingRect height
    let bestHeight = Math.max(actualBrowserHeight, boundingRect.height);

    // Fonts without English glyphs need additional height buffer
    const lacksEnglishGlyphs = fontLacksEnglishGlyphsCached(this.fontFamily);
    if (lacksEnglishGlyphs) {
      const glyphBuffer = this.fontSize * 0.25;
      bestHeight += glyphBuffer;
    }

    return {
      _unwrappedLines: [text.split('')],
      lines: lines,
      graphemeText: text.split(''),
      graphemeLines: graphemeLines,
      justifySpaceMeasurements: justifySpaceMeasurements,
      actualBrowserHeight: bestHeight,
    };
  }




  /**
   * Extract justify space measurements from browser
   * @private
   */
  _extractJustifySpaceMeasurements(element: HTMLElement, lines: string[]) {
    // console.log('=== _extractJustifySpaceMeasurements START ===');
    // console.log('Textbox width:', this.width);
    // console.log('Lines count:', lines.length);

    const measureCtx =
      (this as any)._browserMeasureCtx ||
      ((this as any)._browserMeasureCtx = document
        .createElement('canvas')
        .getContext('2d'));
    if (!measureCtx) {
      // console.log('ERROR: No measure context');
      return [];
    }
    measureCtx.font = `${this.fontStyle || 'normal'} ${this.fontWeight || 'normal'} ${this.fontSize}px "${this.fontFamily}"`;
    const normalSpaceWidth = measureCtx.measureText(' ').width || 6;
    // console.log('Font:', measureCtx.font);
    // console.log('Normal space width:', normalSpaceWidth);

    const spaceWidths: number[][] = [];

    lines.forEach((line, lineIndex) => {
      const lineSpaces: number[] = [];
      const spaceCount = (line.match(/\s/g) || []).length;
      const isLastLine = lineIndex === lines.length - 1;

      // console.log(`\nLine ${lineIndex}: "${line.substring(0, 50)}..." spaces: ${spaceCount}, isLast: ${isLastLine}`);

      if (spaceCount > 0 && !isLastLine) {
        // Don't justify last line
        const naturalWidth = measureCtx.measureText(line).width;
        const remainingSpace = this.width - naturalWidth;
        const extraPerSpace = remainingSpace > 0 ? remainingSpace / spaceCount : 0;
        const expandedSpaceWidth = normalSpaceWidth + extraPerSpace;

        // console.log(`  Natural width: ${naturalWidth.toFixed(2)}, Remaining: ${remainingSpace.toFixed(2)}`);
        // console.log(`  Extra per space: ${extraPerSpace.toFixed(2)}, Expanded space: ${expandedSpaceWidth.toFixed(2)}`);

        const safeWidth = Math.max(normalSpaceWidth, expandedSpaceWidth);
        for (let i = 0; i < spaceCount; i++) {
          lineSpaces.push(safeWidth);
        }
      } else if (spaceCount > 0) {
        // Last line: keep natural space width
        // console.log(`  Last line - using normal space width: ${normalSpaceWidth}`);
        for (let i = 0; i < spaceCount; i++) {
          lineSpaces.push(normalSpaceWidth);
        }
      }

      spaceWidths.push(lineSpaces);
    });

    // console.log('\nFinal spaceWidths:', spaceWidths);
    // console.log('=== _extractJustifySpaceMeasurements END ===\n');
    return spaceWidths;
  }

  /**
   * Apply justify space expansion using actual charBounds measurements.
   * Supports Arabic kashida (tatweel) justification when kashida property is set.
   * @private
   */
  _applyBrowserJustifySpaces() {
    if (!this._textLines || !this.__charBounds) {
      return;
    }

    // Kashida ratios: proportion of extra space distributed via kashida vs space expansion
    const kashidaRatios: Record<string, number> = {
      none: 0,
      short: 0.25,
      medium: 0.5,
      long: 0.75,
      stylistic: 1.0,
    };
    const kashidaRatio = kashidaRatios[this.kashida] || 0;

    // Reset kashida info
    this.__kashidaInfo = [];

    const totalLines = this._textLines.length;

    this._textLines.forEach((line, lineIndex) => {
      // Initialize kashida info for this line
      this.__kashidaInfo[lineIndex] = [];

      if (!this.__charBounds || !this.__charBounds[lineIndex]) {
        return;
      }

      // Don't justify the last line
      const isLastLine = lineIndex === totalLines - 1;
      if (isLastLine) {
        return;
      }

      const lineBounds = this.__charBounds[lineIndex];

      // Calculate current line width from charBounds
      const currentLineWidth = lineBounds.reduce((sum, b) => sum + (b?.kernedWidth || 0), 0);
      const totalExtraSpace = this.width - currentLineWidth;

      if (totalExtraSpace <= 0) {
        return;
      }

      // Count spaces and find space indices
      const spaceIndices: number[] = [];
      for (let i = 0; i < line.length; i++) {
        if (/\s/.test(line[i])) {
          spaceIndices.push(i);
        }
      }
      const spaceCount = spaceIndices.length;

      // Find kashida points if enabled
      const kashidaPoints = kashidaRatio > 0 ? findKashidaPoints(line) : [];
      const hasKashidaPoints = kashidaPoints.length > 0;

      // Calculate space distribution
      let kashidaSpace = 0;
      let spaceExpansion = totalExtraSpace;

      if (hasKashidaPoints && kashidaRatio > 0) {
        // Distribute between kashida and spaces
        kashidaSpace = totalExtraSpace * kashidaRatio;
        spaceExpansion = totalExtraSpace * (1 - kashidaRatio);
      }

      // Calculate per-kashida and per-space widths
      const perKashidaWidth = hasKashidaPoints ? kashidaSpace / kashidaPoints.length : 0;
      const perSpaceWidth = spaceCount > 0 ? spaceExpansion / spaceCount : 0;

      // If kashida is enabled, insert actual tatweel characters
      if (hasKashidaPoints && perKashidaWidth > 0) {
        // console.log(`=== Inserting kashida in _applyBrowserJustifySpaces line ${lineIndex} ===`);

        // Sort by charIndex descending to insert from end
        const sortedPoints = [...kashidaPoints].sort((a, b) => b.charIndex - a.charIndex);

        // Calculate tatweel width
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.font = this._getFontDeclaration();
          const tatweelWidth = ctx.measureText(ARABIC_TATWEEL).width;
          // console.log(`  tatweelWidth: ${tatweelWidth}`);

          if (tatweelWidth > 0) {
            const newLine = [...line];

            for (const point of sortedPoints) {
              const tatweelCount = Math.max(1, Math.round(perKashidaWidth / tatweelWidth));
              // console.log(`  Point ${point.charIndex}: inserting ${tatweelCount} tatweels`);

              // Insert tatweels after the character
              for (let t = 0; t < tatweelCount; t++) {
                newLine.splice(point.charIndex + 1, 0, ARABIC_TATWEEL);
              }

              // Store kashida info with tatweelCount for index conversion
              this.__kashidaInfo[lineIndex].push({
                charIndex: point.charIndex,
                width: perKashidaWidth,
                tatweelCount: tatweelCount,
              });
            }

            // console.log(`  New line: ${newLine.join('')}`);

            // Update _textLines with kashida
            this._textLines[lineIndex] = newLine;

            // Update textLines string version
            if (this.textLines && this.textLines[lineIndex] !== undefined) {
              (this as any).textLines[lineIndex] = newLine.join('');
            }

            // Recalculate charBounds
            this.__charBounds[lineIndex] = [];
            this.__lineWidths[lineIndex] = undefined as any;
            this._measureLine(lineIndex);
          }
        }
      } else {
        // No kashida - just store info for reference (tatweelCount is 0 since no tatweels inserted)
        for (const point of kashidaPoints) {
          this.__kashidaInfo[lineIndex].push({ charIndex: point.charIndex, width: perKashidaWidth, tatweelCount: 0 });
        }
      }

      // Now apply space expansion to remaining extra space
      const newLineBounds = this.__charBounds[lineIndex];
      const newLineWidth = newLineBounds.reduce((sum, b) => sum + (b?.kernedWidth || 0), 0);
      const remainingSpace = this.width - newLineWidth;

      if (remainingSpace > 0 && spaceCount > 0) {
        const extraPerSpace = remainingSpace / spaceCount;
        let accumulated = 0;

        for (let charIndex = 0; charIndex < this._textLines[lineIndex].length; charIndex++) {
          const bound = newLineBounds[charIndex];
          if (!bound) continue;

          bound.left += accumulated;

          // Check if this is a space (need to check against the updated line)
          if (/\s/.test(this._textLines[lineIndex][charIndex])) {
            bound.width += extraPerSpace;
            bound.kernedWidth += extraPerSpace;
            accumulated += extraPerSpace;
          }
        }
      }

      // Update cached line width
      const finalLineBounds = this.__charBounds[lineIndex];
      const finalLineWidth = finalLineBounds.reduce((max, b) => Math.max(max, (b?.left || 0) + (b?.width || 0)), 0);
      this.__lineWidths[lineIndex] = finalLineWidth;
    });

    this.dirty = true;
    // Mark that justify has been applied - for debugging to detect if measureLine overwrites it
    (this as any)._justifyApplied = true;

    // Debug log final kashida state
    // console.log('=== _applyBrowserJustifySpaces END ===');
    // console.log('Final __kashidaInfo:', JSON.stringify(this.__kashidaInfo.map((lineInfo, i) => ({
    //   line: i,
    //   entries: lineInfo.map(k => ({ charIndex: k.charIndex, tatweelCount: k.tatweelCount }))
    // }))));
  }

  /**
   * Fallback to default Fabric wrapping
   * @private
   */
  _splitTextIntoLinesDefault(text: string) {
    const newText = super._splitTextIntoLines(text),
      graphemeLines = this._wrapText(newText.lines, this.width),
      lines = new Array(graphemeLines.length);
    for (let i = 0; i < graphemeLines.length; i++) {
      lines[i] = graphemeLines[i].join('');
    }
    newText.lines = lines;
    newText.graphemeLines = graphemeLines;
    return newText;
  }

  getMinWidth() {
    return Math.max(this.minWidth, this.dynamicMinWidth);
  }

  _removeExtraneousStyles() {
    const linesToKeep = new Map();
    for (const prop in this._styleMap) {
      const propNumber = parseInt(prop, 10);
      if (this._textLines[propNumber]) {
        const lineIndex = this._styleMap[prop].line;
        linesToKeep.set(`${lineIndex}`, true);
      }
    }
    for (const prop in this.styles) {
      if (!linesToKeep.has(prop)) {
        delete this.styles[prop];
      }
    }
  }

  /**
   * Initialize event listeners for safety snap functionality
   * @private
   */
  private initializeEventListeners(): void {
    // Track which side is being used for resize to handle position compensation
    let resizeOrigin: 'left' | 'right' | null = null;
    
    // Detect resize origin during resizing
    this.on('resizing', (e: any) => {
      // Check transform origin to determine which side is being resized
      if (e.transform) {
        const { originX } = e.transform;
        // originX tells us which side is the anchor - opposite side is being dragged
        resizeOrigin = originX === 'right' ? 'left' : originX === 'left' ? 'right' : null;
      } else if (e.originX) {
        const { originX } = e;
        resizeOrigin = originX === 'right' ? 'left' : originX === 'left' ? 'right' : null;
      }
    });
    
    // Only trigger safety snap after resize is complete (not during)
    // Use 'modified' event which fires after user releases the mouse
    this.on('modified', () => {
      const currentResizeOrigin = resizeOrigin; // Capture the value before reset
      // Small delay to ensure text layout is updated
      setTimeout(() => this.safetySnapWidth(currentResizeOrigin), 10);
      resizeOrigin = null; // Reset after capturing
    });
    
    // Also listen to canvas-level modified event as backup
    this.canvas?.on('object:modified', (e) => {
      if (e.target === this) {
        const currentResizeOrigin = resizeOrigin; // Capture the value before reset
        setTimeout(() => this.safetySnapWidth(currentResizeOrigin), 10);
        resizeOrigin = null; // Reset after capturing
      }
    });
  }

  /**
   * Safety snap to prevent glyph clipping after manual resize.
   * Similar to Polotno - checks if any glyphs are too close to edges
   * and automatically expands width if needed.
   * @private
   * @param resizeOrigin - Which side was used for resizing ('left' or 'right')
   */
  private safetySnapWidth(resizeOrigin?: 'left' | 'right' | null): void {
    if (
      !this._textLines ||
      this.type.toLowerCase() !== 'textbox' ||
      this._textLines.length === 0
    ) {
      return;
    }
    if (resizeOrigin === null || resizeOrigin === undefined) {
      return;
    }

    const lineCount = this._textLines.length;
    if (lineCount === 0) return;

    let maxRequiredWidth = 0;

    for (let i = 0; i < lineCount; i++) {
      const lineText = this._textLines[i].join('');
      const lineWidth = this.getLineWidth(i);

      // RTL detection
      const rtlRegex =
        /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
      if (rtlRegex.test(lineText)) {
        const rtlBuffer = (this.fontSize || 16) * 0.15;
        maxRequiredWidth = Math.max(maxRequiredWidth, lineWidth + rtlBuffer);
      } else {
        maxRequiredWidth = Math.max(maxRequiredWidth, lineWidth);
      }
    }

    const safetyThreshold = 2;

    if (maxRequiredWidth > this.width - safetyThreshold) {
      const newWidth = maxRequiredWidth + 1;
      const originalLeft = this.left;
      const originalTop = this.top;
      const widthIncrease = newWidth - this.width;
      const hadLock = this.lockDynamicMinWidth;

      this.lockDynamicMinWidth = true;
      this.set('width', newWidth);
      this.initDimensions();
      this.lockDynamicMinWidth = hadLock;

      this.set({
        left: originalLeft - widthIncrease,
        top: originalTop,
      });

      this.setCoords();

      if ((this as any).__overlayEditor) {
        setTimeout(() => {
          (this as any).__overlayEditor.refresh();
        }, 0);
      }

      this.canvas?.requestRenderAll();
    }
  }

  /**
   * Fix character selection mismatch after JSON loading for browser-wrapped fonts
   * @private
   */
  _fixCharacterMappingAfterJsonLoad(): void {
    if ((this as any)._usingBrowserWrapping) {
      // Clear all cached states to force fresh text layout calculation
      (this as any)._browserWrapCache = null;
      (this as any)._lastDimensionState = null;
      
      // Force complete re-initialization
      this.initDimensions();
      this._forceClearCache = true;
      
      // Ensure canvas refresh
      this.setCoords();
      if (this.canvas) {
        this.canvas.requestRenderAll();
      }
    }
  }

  /**
   * Force complete textbox re-initialization (useful after JSON loading)
   * Overrides Text version with Textbox-specific logic
   */
  forceTextReinitialization(): void {
    this.initialized = true;
    this._clearCache();
    this.dirty = true;
    this.dynamicMinWidth = 0;
    this.isEditing = false;

    this.initDimensions();

    // Ensure justify is applied correctly
    if (this.textAlign.includes('justify') && this.__charBounds) {
      setTimeout(() => {
        // Verify justify was applied
        let hasVariableSpaces = false;
        this.__charBounds.forEach((lineBounds, i) => {
          if (lineBounds && this._textLines && this._textLines[i]) {
            const spaces = lineBounds.filter((bound, j) =>
              /\s/.test(this._textLines[i][j]),
            );
            if (spaces.length > 1) {
              const firstSpaceWidth = spaces[0].width;
              hasVariableSpaces = spaces.some(
                (space) => Math.abs(space.width - firstSpaceWidth) > 0.1,
              );
            }
          }
        });

        if (!hasVariableSpaces && this.__charBounds.length > 0) {
          if (this.enlargeSpaces) {
            this.enlargeSpaces();
          }
        }

        // Recalculate height
        if (
          (this as any)._usingBrowserWrapping &&
          (this as any)._actualBrowserHeight
        ) {
          this.height = (this as any)._actualBrowserHeight;
        } else {
          this.height = this.calcTextHeight();
        }
        this.canvas?.requestRenderAll();
      }, 10);
    }
  }

  /**
   * Returns object representation of an instance
   * @param {Array} [propertiesToInclude] Any properties that you might want to additionally include in the output
   * @return {Object} object representation of an instance
   */
  toObject<
    T extends Omit<Props & TClassProperties<this>, keyof SProps>,
    K extends keyof T = never,
  >(propertiesToInclude: K[] = []): Pick<T, K> & SProps {
    return super.toObject<T, K>([
      'minWidth',
      'splitByGrapheme',
      ...propertiesToInclude,
    ] as K[]);
  }
}

classRegistry.setClass(Textbox);
