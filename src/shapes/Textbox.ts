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
    
    // Prevent rapid recalculations during moves
    if ((this as any)._usingBrowserWrapping) {
      const now = Date.now();
      const lastCall = (this as any)._lastInitDimensionsTime || 0;
      const isRapidCall = now - lastCall < 100;
      const isDuringLoading = (this as any)._jsonLoading || !(this as any)._browserWrapInitialized;
      
      if (isRapidCall && !isDuringLoading) {
        return;
      }
      (this as any)._lastInitDimensionsTime = now;
    }
    
    // Skip if nothing changed
    const currentState = `${this.text}|${this.width}|${this.fontSize}|${this.fontFamily}|${this.textAlign}`;
    if ((this as any)._lastDimensionState === currentState && this._textLines && this._textLines.length > 0) {
      return;
    }
    (this as any)._lastDimensionState = currentState;
    
    // Use advanced layout if enabled
    if (this.enableAdvancedLayout) {
      return this.initDimensionsAdvanced();
    }
    
    this.isEditing && this.initDelayedCursor();
    this._clearCache();
    // clear dynamicMinWidth as it will be different after we re-wrap line
    this.dynamicMinWidth = 0;
    // wrap lines
    const splitTextResult = this._splitText();
    this._styleMap = this._generateStyleMap(splitTextResult);
    
    // For browser wrapping, ensure _textLines is set from browser results
    if ((this as any)._usingBrowserWrapping && splitTextResult && splitTextResult.lines) {
      this._textLines = splitTextResult.lines.map(line => line.split(''));
      
      // Store justify measurements and browser height
      const justifyMeasurements = (splitTextResult as any).justifySpaceMeasurements;
      if (justifyMeasurements) {
        (this._styleMap as any).justifySpaceMeasurements = justifyMeasurements;
      }
      
      const actualHeight = (splitTextResult as any).actualBrowserHeight;
      if (actualHeight) {
        (this as any)._actualBrowserHeight = actualHeight;
      }
    }
    // Don't auto-resize width when using browser wrapping to prevent width increases during moves
    if (!((this as any)._usingBrowserWrapping) && this.dynamicMinWidth > this.width) {
      this._set('width', this.dynamicMinWidth);
    }
    
    // For browser wrapping fonts (like STV), ensure minimum width for new textboxes
    // since these fonts can't measure English characters properly
    if ((this as any)._usingBrowserWrapping && this.width < 50) {
      console.log(`🔤 BROWSER WRAP: Font ${this.fontFamily} has width ${this.width}px, setting to 300px for usability`);
      this.width = 300;
    }
    
    // Mark browser wrapping as initialized when complete
    if ((this as any)._usingBrowserWrapping) {
      (this as any)._browserWrapInitialized = true;
    }
    
    if (this.textAlign.includes(JUSTIFY)) {
      // For browser wrapping fonts, apply browser-calculated justify spaces
      if ((this as any)._usingBrowserWrapping) {
        console.log('🔤 BROWSER WRAP: Applying browser-calculated justify spaces');
        this._applyBrowserJustifySpaces();
        return;
      }
      
      // Don't apply justify alignment during drag operations to prevent snapping
      const now = Date.now();
      const lastDragTime = (this as any)._lastInitDimensionsTime || 0;
      const isDuringDrag = now - lastDragTime < 200; // 200ms window for drag detection
      
      if (isDuringDrag) {
        console.log('🔤 Skipping justify during drag operation to prevent snapping');
        return;
      }
      
      // For non-browser-wrapping fonts, use Fabric's justify system
      // once text is measured we need to make space fatter to make justified text.
      // Ensure __charBounds exists and fonts are ready before applying justify
      if (this.__charBounds && this.__charBounds.length > 0) {
        // Check if font is ready for accurate justify calculations
        const fontReady = this._isFontReady ? this._isFontReady() : true;
        if (fontReady) {
          this.enlargeSpaces();
        } else {
          console.warn('⚠️ Textbox: Font not ready for justify, deferring enlargeSpaces');
          // Defer justify calculation until font is ready
          this._scheduleJustifyAfterFontLoad();
        }
      } else {
        console.warn('⚠️ Textbox: __charBounds not ready for justify alignment, deferring enlargeSpaces');
        // Defer the justify calculation until the next frame
        setTimeout(() => {
          if (this.__charBounds && this.__charBounds.length > 0 && this.enlargeSpaces) {
            console.log('🔧 Applying deferred Textbox justify alignment');
            this.enlargeSpaces();
            this.canvas?.requestRenderAll();
          }
        }, 0);
      }
    }
    // Calculate height - use Fabric's calculation for proper text rendering space
    if ((this as any)._usingBrowserWrapping && this._textLines && this._textLines.length > 0) {
      const actualBrowserHeight = (this as any)._actualBrowserHeight;
      const oldHeight = this.height;
      // Use Fabric's height calculation since it knows how much space text rendering needs
      this.height = this.calcTextHeight();
      
      // Force canvas refresh and control update if height changed significantly
      if (Math.abs(this.height - oldHeight) > 1) {
        this.setCoords();
        this.canvas?.requestRenderAll();
        
        // DEBUG: Log exact positioning details
        console.log(`🎯 POSITIONING DEBUG:`);
        console.log(`   Textbox height: ${this.height}px`);
        console.log(`   Textbox top: ${this.top}px`);
        console.log(`   Textbox left: ${this.left}px`);
        console.log(`   Text lines: ${this._textLines?.length || 0}`);
        console.log(`   Font size: ${this.fontSize}px`);
        console.log(`   Line height: ${this.lineHeight || 1.16}`);
        console.log(`   Calculated line height: ${this.fontSize * (this.lineHeight || 1.16)}px`);
        console.log(`   _getTopOffset(): ${this._getTopOffset()}px`);
        console.log(`   calcTextHeight(): ${this.calcTextHeight()}px`);
        console.log(`   Browser height: ${actualBrowserHeight}px`);
        console.log(`   Height difference: ${this.height - this.calcTextHeight()}px`);
      }
    } else {
      this.height = this.calcTextHeight();
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
    
    // Only schedule if not already waiting
    if ((this as any)._fontJustifyScheduled) {
      return;
    }
    (this as any)._fontJustifyScheduled = true;
    
    const fontSpec = `${this.fontSize}px ${this.fontFamily}`;
    document.fonts.load(fontSpec).then(() => {
      (this as any)._fontJustifyScheduled = false;
      console.log('🔧 Textbox: Font loaded, applying justify alignment');
      
      // Re-run initDimensions to ensure proper justify calculation
      this.initDimensions();
      this.canvas?.requestRenderAll();
    }).catch(() => {
      (this as any)._fontJustifyScheduled = false;
      console.warn('⚠️ Textbox: Font loading failed, justify may be incorrect');
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
    this.dynamicMinWidth = 0;
    
    // Use new layout engine
    const layout = layoutText({
      text: this.text,
      width: this.width,
      height: this.height,
      wrap: this.wrap || 'word',
      align: (this as any)._mapTextAlignToAlign(this.textAlign),
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
    
    // Update dynamic minimum width based on layout
    if (layout.lines.length > 0) {
      const maxLineWidth = Math.max(...layout.lines.map(line => line.width));
      this.dynamicMinWidth = Math.max(this.minWidth, maxLineWidth);
    }
    
    // Adjust width if needed (preserving Textbox behavior)
    if (this.dynamicMinWidth > this.width) {
      this._set('width', this.dynamicMinWidth);
      // Re-layout with new width
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
    
    // Generate style map for compatibility
    this._styleMap = this._generateStyleMapFromLayout(layout);
    this.dirty = true;
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

    const maxWidth = Math.max(
      desiredWidth,
      largestWordWidth,
      this.dynamicMinWidth,
    );
    // layout words
    const data = wordsData[lineIndex];
    offset = 0;
    let i;
    for (i = 0; i < data.length; i++) {
      const { word, width: wordWidth } = data[i];
      offset += word.length;

      // Predictive wrapping: check if adding this word would exceed the width
      const potentialLineWidth = lineWidth + infixWidth + wordWidth - additionalSpace;
      // Use exact width to match overlay editor behavior
      const conservativeMaxWidth = maxWidth; // No artificial buffer
      
      // Debug logging for wrapping decisions
      const currentLineText = line.join('');
      console.log(`🔧 FABRIC WRAP CHECK: "${data[i].word}" -> potential: ${potentialLineWidth.toFixed(1)}px vs limit: ${conservativeMaxWidth.toFixed(1)}px`);
      
      if (potentialLineWidth > conservativeMaxWidth && !lineJustStarted) {
        // This word would exceed the width, wrap before adding it
        console.log(`🔧 FABRIC WRAP! Line: "${currentLineText}" (${lineWidth.toFixed(1)}px)`);
        graphemeLines.push(line);
        line = [];
        lineWidth = wordWidth; // Start new line with just this word
        lineJustStarted = true;
      } else {
        // Word fits, add it to current line
        lineWidth = potentialLineWidth + additionalSpace;
      }

      if (!lineJustStarted && !splitByGrapheme) {
        line.push(infix);
      }
      line = line.concat(word);
      
      // Debug: show current line after adding word
      console.log(`🔧 FABRIC AFTER ADD: Line now: "${line.join('')}" (${line.length} chars)`);
      

      infixWidth = splitByGrapheme
        ? 0
        : this._measureWord([infix], lineIndex, offset);
      offset++;
      lineJustStarted = false;
    }

    i && graphemeLines.push(line);

    // TODO: this code is probably not necessary anymore.
    // it can be moved out of this function since largestWordWidth is now
    // known in advance
    // Don't modify dynamicMinWidth when using browser wrapping to prevent width increases
    if (!((this as any)._usingBrowserWrapping) && largestWordWidth + reservedSpace > this.dynamicMinWidth) {
      console.log(`🔧 FABRIC updating dynamicMinWidth: ${this.dynamicMinWidth} -> ${largestWordWidth - additionalSpace + reservedSpace}`);
      this.dynamicMinWidth = largestWordWidth - additionalSpace + reservedSpace;
    } else if ((this as any)._usingBrowserWrapping) {
      console.log(`🔤 BROWSER WRAP: Skipping dynamicMinWidth update to prevent width increase`);
    }
    
    // Debug: show final wrapped lines
    console.log(`🔧 FABRIC FINAL LINES: ${graphemeLines.length} lines`);
    graphemeLines.forEach((line, i) => {
      console.log(`   Line ${i + 1}: "${line.join('')}" (${line.length} chars)`);
    });
    
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
      console.warn('Browser wrapping failed, using fallback:', error);
      document.body.removeChild(testElement);
      return this._splitTextIntoLinesDefault(text);
    }

    // Extract actual browser height BEFORE removing element
    const actualBrowserHeight = testElement.scrollHeight;
    const offsetHeight = testElement.offsetHeight;
    const clientHeight = testElement.clientHeight;
    const boundingRect = testElement.getBoundingClientRect();
    
    console.log(`🔤 Browser element measurements:`);
    console.log(`   scrollHeight: ${actualBrowserHeight}px (content + padding + hidden overflow)`);
    console.log(`   offsetHeight: ${offsetHeight}px (content + padding + border)`);
    console.log(`   clientHeight: ${clientHeight}px (content + padding, no border/scrollbar)`);
    console.log(`   boundingRect.height: ${boundingRect.height}px (actual rendered height)`);
    console.log(`   Font size: ${this.fontSize}px, Line height: ${this.lineHeight || 1.16}, Lines: ${lines.length}`);

    // For justify alignment, extract space measurements from browser BEFORE removing element
    let justifySpaceMeasurements = null;
    if (this.textAlign.includes('justify')) {
      justifySpaceMeasurements = this._extractJustifySpaceMeasurements(testElement, lines);
    }

    document.body.removeChild(testElement);

    console.log(`🔤 Browser wrapping result: ${lines.length} lines`);
    
    // Try different height measurements to find the most accurate
    let bestHeight = actualBrowserHeight;
    
    // If scrollHeight and offsetHeight differ significantly, investigate
    if (Math.abs(actualBrowserHeight - offsetHeight) > 2) {
      console.log(`🔤 Height discrepancy detected: scrollHeight=${actualBrowserHeight}px vs offsetHeight=${offsetHeight}px`);
    }
    
    // Consider using boundingRect height if it's larger (sometimes more accurate for visible content)
    if (boundingRect.height > bestHeight) {
      console.log(`🔤 Using boundingRect height (${boundingRect.height}px) instead of scrollHeight (${bestHeight}px)`);
      bestHeight = boundingRect.height;
    }
    
    // Font-specific height adjustments for accurate bounding box
    let adjustedHeight = bestHeight;
    
    // Fonts without English glyphs need additional height buffer due to different font metrics
    const lacksEnglishGlyphs = fontLacksEnglishGlyphsCached(this.fontFamily);
    if (lacksEnglishGlyphs) {
      const glyphBuffer = this.fontSize * 0.25; // 25% of font size for non-English fonts
      adjustedHeight = bestHeight + glyphBuffer;
      console.log(`🔤 Non-English font detected (${this.fontFamily}): Adding ${glyphBuffer}px buffer (${bestHeight}px + ${glyphBuffer}px = ${adjustedHeight}px)`);
    } else {
      console.log(`🔤 Standard font (${this.fontFamily}): Using browser height directly (${bestHeight}px)`);
    }
    
    return {
      _unwrappedLines: [text.split('')],
      lines: lines,
      graphemeText: text.split(''),
      graphemeLines: graphemeLines,
      justifySpaceMeasurements: justifySpaceMeasurements,
      actualBrowserHeight: adjustedHeight,
    };
  }




  /**
   * Extract justify space measurements from browser
   * @private
   */
  _extractJustifySpaceMeasurements(element: HTMLElement, lines: string[]) {
    console.log(`🔤 Extracting browser justify space measurements for ${lines.length} lines`);
    
    // For now, we'll use a simplified approach:
    // Apply uniform space expansion to match the line width
    const spaceWidths: number[][] = [];
    
    lines.forEach((line, lineIndex) => {
      const lineSpaces: number[] = [];
      const spaceCount = (line.match(/\s/g) || []).length;
      
      if (spaceCount > 0 && lineIndex < lines.length - 1) { // Don't justify last line
        // Calculate how much space expansion is needed
        const normalSpaceWidth = 6.4; // Default space width for STV font
        const lineWidth = this.width;
        
        // Estimate natural line width
        const charCount = line.length - spaceCount;
        const avgCharWidth = 12; // Approximate for STV font
        const naturalWidth = charCount * avgCharWidth + spaceCount * normalSpaceWidth;
        
        // Calculate expanded space width
        const remainingSpace = lineWidth - (charCount * avgCharWidth);
        const expandedSpaceWidth = remainingSpace / spaceCount;
        
        console.log(`🔤 Line ${lineIndex}: ${spaceCount} spaces, natural: ${normalSpaceWidth}px -> justified: ${expandedSpaceWidth.toFixed(1)}px`);
        
        // Fill array with expanded space widths for this line
        for (let i = 0; i < spaceCount; i++) {
          lineSpaces.push(expandedSpaceWidth);
        }
      }
      
      spaceWidths.push(lineSpaces);
    });
    
    return spaceWidths;
  }

  /**
   * Apply browser-calculated justify space measurements
   * @private
   */
  _applyBrowserJustifySpaces() {
    if (!this._textLines || !this.__charBounds) {
      console.warn('🔤 BROWSER JUSTIFY: _textLines or __charBounds not ready');
      return;
    }

    // Get space measurements from browser wrapping result
    const styleMap = this._styleMap as any;
    if (!styleMap || !styleMap.justifySpaceMeasurements) {
      console.warn('🔤 BROWSER JUSTIFY: No justify space measurements available');
      return;
    }

    const spaceWidths = styleMap.justifySpaceMeasurements as number[][];
    console.log('🔤 BROWSER JUSTIFY: Applying space measurements to __charBounds');

    // Apply space widths to character bounds
    this._textLines.forEach((line, lineIndex) => {
      if (!this.__charBounds || !this.__charBounds[lineIndex] || !spaceWidths[lineIndex]) return;
      
      const lineBounds = this.__charBounds[lineIndex];
      const lineSpaceWidths = spaceWidths[lineIndex];
      let spaceIndex = 0;

      for (let charIndex = 0; charIndex < line.length; charIndex++) {
        if (/\s/.test(line[charIndex]) && spaceIndex < lineSpaceWidths.length) {
          const expandedWidth = lineSpaceWidths[spaceIndex];
          if (lineBounds[charIndex]) {
            const oldWidth = lineBounds[charIndex].width;
            lineBounds[charIndex].width = expandedWidth;
            console.log(`🔤 Line ${lineIndex} space ${spaceIndex}: ${oldWidth.toFixed(1)}px -> ${expandedWidth.toFixed(1)}px`);
          }
          spaceIndex++;
        }
      }
    });
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
    // For Textbox objects, we always want to check for clipping regardless of isWrapping flag
    if (!this._textLines || this.type.toLowerCase() !== 'textbox' || this._textLines.length === 0) {
      return;
    }
    
    const lineCount = this._textLines.length;
    if (lineCount === 0) return;

    // Check all lines, not just the last one
    let maxActualLineWidth = 0; // Actual measured width without buffers
    let maxRequiredWidth = 0;   // Width including RTL buffer
    
    for (let i = 0; i < lineCount; i++) {
      const lineText = this._textLines[i].join(''); // Convert grapheme array to string
      const lineWidth = this.getLineWidth(i);
      maxActualLineWidth = Math.max(maxActualLineWidth, lineWidth);
      
      // RTL detection - regex for Arabic, Hebrew, and other RTL characters
      const rtlRegex = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
      if (rtlRegex.test(lineText)) {
        // Add minimal RTL compensation buffer - just enough to prevent clipping
        const rtlBuffer = (this.fontSize || 16) * 0.15; // 15% of font size (much smaller)
        maxRequiredWidth = Math.max(maxRequiredWidth, lineWidth + rtlBuffer);
      } else {
        maxRequiredWidth = Math.max(maxRequiredWidth, lineWidth);
      }
    }

    // Safety margin - how close glyphs can get before we snap
    const safetyThreshold = 2; // px - very subtle trigger
    
    if (maxRequiredWidth > this.width - safetyThreshold) {
      // Set width to exactly what's needed + minimal safety margin
      const newWidth = maxRequiredWidth + 1; // Add just 1px safety margin
      
      // Store original position before width change
      const originalLeft = this.left;
      const originalTop = this.top;
      const widthIncrease = newWidth - this.width;
      
      // Change width 
      this.set('width', newWidth);
      
      // Force text layout recalculation
      this.initDimensions();
      
      // Only compensate position when resizing from left handle
      // Right handle resize doesn't shift the text position
      if (resizeOrigin === 'left') {
        // When resizing from left, the expansion pushes text right
        // Compensate by moving the textbox left by the width increase
        this.set({
          'left': originalLeft - widthIncrease,
          'top': originalTop
        });
      }
      
      this.setCoords();
      
      // Also refresh the overlay editor if it exists
      if ((this as any).__overlayEditor) {
        setTimeout(() => {
          (this as any).__overlayEditor.refresh();
        }, 0);
      }
      
      this.canvas?.requestRenderAll();
    }
  }

  /**
   * Force complete textbox re-initialization (useful after JSON loading)
   * Overrides Text version with Textbox-specific logic
   */
  forceTextReinitialization(): void {
    console.log('🔄 Force reinitializing Textbox object');
    
    // CRITICAL: Ensure textbox is marked as initialized
    this.initialized = true;
    
    // Clear all caches and force dirty state
    this._clearCache();
    this.dirty = true;
    this.dynamicMinWidth = 0;
    
    // Force isEditing false to ensure clean state
    this.isEditing = false;
    
    console.log('   → Set initialized=true, dirty=true, cleared caches');
    
    // Re-initialize dimensions (this will handle justify properly)
    this.initDimensions();
    
    // Double-check that justify was applied by checking space widths
    if (this.textAlign.includes('justify') && this.__charBounds) {
      setTimeout(() => {
        // Verify justify was applied by checking if space widths vary
        let hasVariableSpaces = false;
        this.__charBounds.forEach((lineBounds, i) => {
          if (lineBounds && this._textLines && this._textLines[i]) {
            const spaces = lineBounds.filter((bound, j) => /\s/.test(this._textLines[i][j]));
            if (spaces.length > 1) {
              const firstSpaceWidth = spaces[0].width;
              hasVariableSpaces = spaces.some(space => Math.abs(space.width - firstSpaceWidth) > 0.1);
            }
          }
        });
        
        if (!hasVariableSpaces && this.__charBounds.length > 0) {
          console.warn('   ⚠️ Justify spaces still uniform - forcing enlargeSpaces again');
          if (this.enlargeSpaces) {
            this.enlargeSpaces();
          }
        } else {
          console.log('   ✅ Justify spaces properly expanded');
        }
        
        // Ensure height is recalculated - use browser height if available
        if ((this as any)._usingBrowserWrapping && (this as any)._actualBrowserHeight) {
          this.height = (this as any)._actualBrowserHeight;
          console.log(`🔤 JUSTIFY: Preserved browser height: ${this.height}px`);
        } else {
          this.height = this.calcTextHeight();
          console.log(`🔧 JUSTIFY: Used calcTextHeight: ${this.height}px`);
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
