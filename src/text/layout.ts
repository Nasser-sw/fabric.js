/**
 * Core Text Layout Engine
 * 
 * Implements Konva-compatible text layout with support for:
 * - Multiple wrap modes (word/char/none)
 * - Ellipsis truncation
 * - Justify alignment with proper space distribution
 * - RTL/LTR text direction
 * - Advanced grapheme handling
 */

import { graphemeSplit } from '../util/lang_string';
import type { MeasurementOptions, GraphemeMeasurement, KerningMeasurement } from './measure';
import { measureGrapheme, measureGraphemeWithKerning, getFontMetrics } from './measure';
import type { EllipsisResult } from './ellipsis';
import { applyEllipsis } from './ellipsis';
import { segmentGraphemes, analyzeBiDi, type BiDiRun } from './unicode';

export interface TextLayoutOptions {
  text: string;
  width?: number;
  height?: number;
  wrap: 'word' | 'char' | 'none';
  align: 'left' | 'center' | 'right' | 'justify';
  ellipsis?: boolean | string;
  fontSize: number;
  lineHeight: number;
  letterSpacing?: number; // px-based (Konva style)
  charSpacing?: number;   // em-based (Fabric style) 
  direction: 'ltr' | 'rtl' | 'inherit';
  fontFamily: string;
  fontStyle: string;
  fontWeight: string | number;
  padding?: number;
  verticalAlign?: 'top' | 'middle' | 'bottom';
}

export interface LayoutResult {
  lines: LayoutLine[];
  totalWidth: number;
  totalHeight: number;
  isTruncated: boolean;
  graphemeCount: number;
  ellipsisApplied?: EllipsisResult;
}

export interface LayoutLine {
  text: string;
  graphemes: string[];
  width: number;
  height: number;
  bounds: GraphemeBounds[];
  isWrapped: boolean;
  isLastInParagraph: boolean;
  justifyRatio?: number; // For justify alignment - space expansion factor
  baseline: number;
}

export interface GraphemeBounds {
  grapheme: string;
  x: number;
  y: number;
  width: number;
  height: number;
  kernedWidth: number;
  left: number;
  baseline: number;
  deltaY?: number;
  charIndex: number; // Logical character index in original text
  graphemeIndex: number; // Logical grapheme index in original text
}

/**
 * Main text layout function - converts text and options into positioned layout
 */
export function layoutText(options: TextLayoutOptions): LayoutResult {
  const {
    text,
    width: containerWidth,
    height: containerHeight,
    wrap,
    align,
    ellipsis,
    direction,
    padding = 0,
    verticalAlign = 'top'
  } = options;

  // Handle empty text
  if (!text) {
    return {
      lines: [],
      totalWidth: 0,
      totalHeight: 0,
      isTruncated: false,
      graphemeCount: 0,
    };
  }

  // Calculate available space
  const maxWidth = containerWidth ? containerWidth - (padding * 2) : Infinity;
  const maxHeight = containerHeight ? containerHeight - (padding * 2) : Infinity;

  // Split text into paragraphs (by \n)
  const paragraphs = text.split('\n');
  
  // Process each paragraph
  const allLines: LayoutLine[] = [];
  let totalHeight = 0;
  let maxLineWidth = 0;
  let totalGraphemes = 0;

  for (let i = 0; i < paragraphs.length; i++) {
    const paragraph = paragraphs[i];
    const isLastParagraph = i === paragraphs.length - 1;
    
    // Layout this paragraph
    const paragraphLines = layoutParagraph(paragraph, {
      ...options,
      width: maxWidth,
      isLastParagraph,
    });
    
    // Check height constraints
    for (const line of paragraphLines) {
      if (containerHeight && totalHeight + line.height > maxHeight) {
        // Height exceeded - truncate here
        const truncatedResult = handleHeightOverflow(
          allLines,
          line,
          maxHeight - totalHeight,
          options
        );
        
        return {
          lines: truncatedResult.lines,
          totalWidth: Math.max(maxLineWidth, ...truncatedResult.lines.map(l => l.width)),
          totalHeight: maxHeight,
          isTruncated: true,
          graphemeCount: totalGraphemes + truncatedResult.addedGraphemes,
          ellipsisApplied: truncatedResult.ellipsisResult,
        };
      }

      // Mark last line in paragraph
      if (line === paragraphLines[paragraphLines.length - 1]) {
        line.isLastInParagraph = true;
      }

      allLines.push(line);
      totalHeight += line.height;
      maxLineWidth = Math.max(maxLineWidth, line.width);
      totalGraphemes += line.graphemes.length;
    }
  }

  // Apply ellipsis if width exceeded and ellipsis enabled
  let ellipsisResult: EllipsisResult | undefined;
  if (ellipsis && containerWidth) {
    for (const line of allLines) {
      if (line.width > maxWidth) {
        ellipsisResult = applyEllipsis(line.text, {
          maxWidth,
          maxHeight: Infinity,
          ellipsisChar: typeof ellipsis === 'string' ? ellipsis : '…',
          measureFn: (text: string) => measureLineWidth(text, options),
        });
        
        if (ellipsisResult.isTruncated) {
          // Rebuild truncated line
          const truncatedLine = layoutSingleLine(ellipsisResult.truncatedText, options);
          Object.assign(line, truncatedLine);
          break;
        }
      }
    }
  }

  // Apply alignment
  const alignedLines = applyAlignment(allLines, align, maxLineWidth, options);

  // Apply vertical alignment
  const verticalOffset = calculateVerticalOffset(
    totalHeight,
    containerHeight || totalHeight,
    verticalAlign
  );

  // Adjust line positions for vertical alignment
  alignedLines.forEach(line => {
    line.bounds.forEach(bound => {
      bound.y += verticalOffset;
    });
  });

  return {
    lines: alignedLines,
    totalWidth: maxLineWidth,
    totalHeight: totalHeight,
    isTruncated: !!ellipsisResult?.isTruncated,
    graphemeCount: totalGraphemes,
    ellipsisApplied: ellipsisResult,
  };
}

/**
 * Layout a single paragraph with wrapping
 */
function layoutParagraph(
  text: string, 
  options: TextLayoutOptions & { width: number; isLastParagraph: boolean }
): LayoutLine[] {
  const { wrap, width: maxWidth } = options;

  if (!text) {
    // Empty paragraph - create empty line
    return [createEmptyLine(options)];
  }

  // Handle no wrapping
  if (wrap === 'none' || maxWidth === Infinity) {
    return [layoutSingleLine(text, options, 0)];
  }

  // Apply wrapping
  const lines: string[] = [];
  
  if (wrap === 'word') {
    lines.push(...wrapByWords(text, maxWidth, options));
  } else if (wrap === 'char') {
    lines.push(...wrapByCharacters(text, maxWidth, options));
  }

  // Convert wrapped lines to layout lines, tracking text offset
  let textOffset = 0;
  const layoutLines = lines.map(lineText => {
    const line = layoutSingleLine(lineText, options, textOffset);
    textOffset += lineText.length + 1; // +1 for newline character
    return line;
  });
  
  return layoutLines;
}

/**
 * Layout a single line of text (no wrapping)
 */
function layoutSingleLine(text: string, options: TextLayoutOptions, textOffset: number = 0): LayoutLine {
  const graphemes = segmentGraphemes(text);
  const bounds: GraphemeBounds[] = [];
  const measurementOptions = createMeasurementOptions(options);

  let x = 0;
  let lineWidth = 0;
  let lineHeight = 0;
  let charIndex = textOffset; // Track character position in original text

  // Measure each grapheme in logical order
  for (let i = 0; i < graphemes.length; i++) {
    const grapheme = graphemes[i];
    const prevGrapheme = i > 0 ? graphemes[i - 1] : undefined;

    // Measure with kerning
    const measurement = measureGraphemeWithKerning(
      grapheme,
      prevGrapheme,
      measurementOptions
    );

    // Apply letter spacing (Konva style - applied to ALL characters including last)
    const letterSpacing = options.letterSpacing || 0;
    const charSpacing = options.charSpacing ?
      (options.fontSize * options.charSpacing) / 1000 : 0;

    const totalSpacing = letterSpacing + charSpacing;
    const effectiveWidth = measurement.kernedWidth + totalSpacing;

    bounds.push({
      grapheme,
      x, // Will be updated by BiDi reordering
      y: 0, // Will be adjusted later
      width: measurement.width,
      height: measurement.height,
      kernedWidth: measurement.kernedWidth,
      left: x, // Logical position (cumulative)
      baseline: measurement.baseline,
      charIndex: charIndex, // Character position in original text
      graphemeIndex: textOffset + i, // Grapheme index in original text
    });

    // Update character index for next iteration
    charIndex += grapheme.length;

    x += effectiveWidth;
    lineWidth += effectiveWidth;
    lineHeight = Math.max(lineHeight, measurement.height);
  }

  // Note: BiDi visual reordering is handled by the browser's canvas fillText
  // The layout stores positions in logical order; hit testing handles the visual mapping

  // Remove trailing spacing from total width (but keep in bounds for rendering)
  if (bounds.length > 0) {
    const letterSpacing = options.letterSpacing || 0;
    const charSpacing = options.charSpacing ?
      (options.fontSize * options.charSpacing) / 1000 : 0;
    const totalSpacing = letterSpacing + charSpacing;

    // Konva applies letterSpacing to all chars, so we don't remove it
    // lineWidth -= totalSpacing;
  }

  // Apply line height
  // Note: Fabric.js uses _fontSizeMult = 1.13 for line height calculation
  const fontSizeMult = 1.13;
  const finalHeight = lineHeight * options.lineHeight * fontSizeMult;

  return {
    text,
    graphemes,
    width: lineWidth,
    height: finalHeight,
    bounds,
    isWrapped: false,
    isLastInParagraph: false,
    baseline: finalHeight * 0.8, // Approximate baseline position
  };
}

/**
 * Word-based wrapping algorithm
 */
function wrapByWords(text: string, maxWidth: number, options: TextLayoutOptions): string[] {
  const lines: string[] = [];
  const words = text.split(/(\s+)/); // Preserve whitespace
  let currentLine = '';
  let currentWidth = 0;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const wordWidth = measureLineWidth(word, options);
    const testLine = currentLine ? currentLine + word : word;
    const testWidth = measureLineWidth(testLine, options);

    // If adding this word exceeds max width and we have content
    if (testWidth > maxWidth && currentLine) {
      lines.push(currentLine.trim());
      currentLine = word;
      currentWidth = wordWidth;
    }
    // If single word is too long, break it by characters
    else if (wordWidth > maxWidth && !currentLine) {
      const brokenWord = wrapByCharacters(word, maxWidth, options);
      lines.push(...brokenWord.slice(0, -1)); // All but last part
      currentLine = brokenWord[brokenWord.length - 1]; // Last part
      currentWidth = measureLineWidth(currentLine, options);
    }
    else {
      currentLine = testLine;
      currentWidth = testWidth;
    }
  }

  if (currentLine) {
    lines.push(currentLine.trim());
  }

  return lines.length > 0 ? lines : [''];
}

/**
 * Character-based wrapping algorithm  
 */
function wrapByCharacters(text: string, maxWidth: number, options: TextLayoutOptions): string[] {
  const lines: string[] = [];
  const graphemes = segmentGraphemes(text);
  let currentLine = '';
  
  for (const grapheme of graphemes) {
    const testLine = currentLine + grapheme;
    const testWidth = measureLineWidth(testLine, options);
    
    if (testWidth > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = grapheme;
    } else {
      currentLine = testLine;
    }
  }
  
  if (currentLine) {
    lines.push(currentLine);
  }
  
  return lines.length > 0 ? lines : [''];
}

/**
 * Apply BiDi visual reordering to calculate correct visual X positions
 * This implements the Unicode Bidirectional Algorithm for character placement
 */
function applyBiDiVisualReordering(
  line: LayoutLine,
  options: TextLayoutOptions
): LayoutLine {
  const baseDirection = options.direction === 'inherit' ? 'ltr' : options.direction;

  // Quick check: if all characters are same direction as base, no reordering needed
  const runs = analyzeBiDi(line.text, baseDirection);
  const hasMixedBiDi = runs.length > 1 || (runs.length === 1 && runs[0].direction !== baseDirection);

  if (!hasMixedBiDi) {
    // For pure LTR or pure RTL, just set visual x = logical left
    // For RTL base direction, we need to flip positions
    if (baseDirection === 'rtl') {
      // RTL: rightmost character should be at x=0, leftmost at x=lineWidth
      line.bounds.forEach(bound => {
        bound.x = line.width - bound.left - bound.kernedWidth;
      });
    }
    // For LTR, x is already correct (same as left)
    return line;
  }

  // Mixed BiDi text - need to reorder runs visually
  // 1. Build mapping from grapheme index to run
  const graphemeToRun: number[] = [];
  let runGraphemeStart = 0;

  for (let runIdx = 0; runIdx < runs.length; runIdx++) {
    const run = runs[runIdx];
    const runGraphemes = segmentGraphemes(run.text);
    for (let i = 0; i < runGraphemes.length; i++) {
      graphemeToRun.push(runIdx);
    }
    runGraphemeStart += runGraphemes.length;
  }

  // 2. Calculate run widths and positions
  const runWidths: number[] = [];
  const runStartIndices: number[] = [];
  let currentIdx = 0;

  for (const run of runs) {
    runStartIndices.push(currentIdx);
    const runGraphemes = segmentGraphemes(run.text);
    let runWidth = 0;
    for (let i = 0; i < runGraphemes.length; i++) {
      if (currentIdx + i < line.bounds.length) {
        const letterSpacing = options.letterSpacing || 0;
        const charSpacing = options.charSpacing ?
          (options.fontSize * options.charSpacing) / 1000 : 0;
        runWidth += line.bounds[currentIdx + i].kernedWidth + letterSpacing + charSpacing;
      }
    }
    runWidths.push(runWidth);
    currentIdx += runGraphemes.length;
  }

  // 3. Determine visual order of runs based on base direction
  // RTL base: runs display right-to-left (first run on right)
  // LTR base: runs display left-to-right (first run on left)
  const visualRunOrder = runs.map((_, i) => i);
  if (baseDirection === 'rtl') {
    visualRunOrder.reverse();
  }

  // 4. Calculate visual X position for each run
  const runVisualX: number[] = new Array(runs.length);
  let currentX = 0;

  for (const runIdx of visualRunOrder) {
    runVisualX[runIdx] = currentX;
    currentX += runWidths[runIdx];
  }

  // 5. Assign visual X positions to each grapheme
  for (let i = 0; i < line.bounds.length; i++) {
    const runIdx = graphemeToRun[i];
    if (runIdx === undefined) continue;

    const run = runs[runIdx];
    const runStart = runStartIndices[runIdx];

    // Calculate spacing once
    const letterSpacing = options.letterSpacing || 0;
    const charSpacing = options.charSpacing ?
      (options.fontSize * options.charSpacing) / 1000 : 0;
    const totalSpacing = letterSpacing + charSpacing;

    // Calculate offset within run (sum of widths of chars before this one)
    let offsetInRun = 0;
    for (let j = runStart; j < i; j++) {
      offsetInRun += line.bounds[j].kernedWidth + totalSpacing;
    }

    // Character width including spacing
    const charWidth = line.bounds[i].kernedWidth + totalSpacing;

    // For RTL runs, characters within the run are reversed visually
    // First logical char appears on the right, last on the left
    if (run.direction === 'rtl') {
      // Visual X = run right edge - cumulative width including this char
      // This places first char at right side of run, last char at left side
      line.bounds[i].x = runVisualX[runIdx] + runWidths[runIdx] - offsetInRun - charWidth;
    } else {
      // LTR run: visual position is run start + offset within run
      line.bounds[i].x = runVisualX[runIdx] + offsetInRun;
    }
  }

  return line;
}

/**
 * Apply text alignment to lines
 */
function applyAlignment(
  lines: LayoutLine[],
  align: string,
  containerWidth: number,
  options: TextLayoutOptions
): LayoutLine[] {
  return lines.map(line => {
    // First apply BiDi reordering to get correct visual X positions
    applyBiDiVisualReordering(line, options);

    let offsetX = 0;

    switch (align) {
      case 'center':
        offsetX = (containerWidth - line.width) / 2;
        break;
      case 'right':
        offsetX = containerWidth - line.width;
        break;
      case 'justify':
        if (!line.isLastInParagraph && line.graphemes.length > 1) {
          return applyJustification(line, containerWidth, options);
        }
        break;
      case 'left':
      default:
        offsetX = 0;
        break;
    }

    // Apply offset to all bounds (both visual x and logical left for alignment)
    if (offsetX !== 0) {
      line.bounds.forEach(bound => {
        bound.x += offsetX;
        bound.left += offsetX;
      });
    }

    return line;
  });
}

/**
 * Apply justify alignment by expanding spaces
 */
function applyJustification(
  line: LayoutLine, 
  containerWidth: number, 
  options: TextLayoutOptions
): LayoutLine {
  const spaces = line.graphemes.filter(g => /\s/.test(g)).length;
  if (spaces === 0) return line;
  
  const extraSpace = containerWidth - line.width;
  const spaceExpansion = extraSpace / spaces;
  
  let offsetX = 0;
  line.bounds.forEach(bound => {
    bound.x += offsetX;
    bound.left += offsetX;
    
    if (/\s/.test(bound.grapheme)) {
      bound.kernedWidth += spaceExpansion;
      bound.width += spaceExpansion;
      offsetX += spaceExpansion;
    }
  });
  
  line.width = containerWidth;
  line.justifyRatio = 1 + (spaceExpansion / (options.fontSize * 0.25)); // Approximate space width
  
  return line;
}

/**
 * Calculate vertical alignment offset
 */
function calculateVerticalOffset(
  contentHeight: number,
  containerHeight: number, 
  align: 'top' | 'middle' | 'bottom'
): number {
  switch (align) {
    case 'middle':
      return (containerHeight - contentHeight) / 2;
    case 'bottom':
      return containerHeight - contentHeight;
    case 'top':
    default:
      return 0;
  }
}

/**
 * Handle height overflow with ellipsis
 */
function handleHeightOverflow(
  existingLines: LayoutLine[],
  overflowLine: LayoutLine,
  remainingHeight: number,
  options: TextLayoutOptions
): { 
  lines: LayoutLine[]; 
  addedGraphemes: number; 
  ellipsisResult?: EllipsisResult;
} {
  // If ellipsis is enabled, try to fit part of the overflow line
  if (options.ellipsis && remainingHeight > 0) {
    const ellipsisChar = typeof options.ellipsis === 'string' ? options.ellipsis : '…';
    const maxWidth = options.width || Infinity;
    
    const ellipsisResult = applyEllipsis(overflowLine.text, {
      maxWidth,
      maxHeight: remainingHeight,
      ellipsisChar,
      measureFn: (text: string) => measureLineWidth(text, options),
    });
    
    if (ellipsisResult.isTruncated) {
      const truncatedLine = layoutSingleLine(ellipsisResult.truncatedText, options);
      truncatedLine.isLastInParagraph = true;
      
      return {
        lines: [...existingLines, truncatedLine],
        addedGraphemes: truncatedLine.graphemes.length,
        ellipsisResult,
      };
    }
  }
  
  return {
    lines: existingLines,
    addedGraphemes: 0,
  };
}

/**
 * Create empty line for empty paragraphs
 */
function createEmptyLine(options: TextLayoutOptions): LayoutLine {
  // Fabric.js uses _fontSizeMult = 1.13 for line height calculation
  const fontSizeMult = 1.13;
  const height = options.fontSize * options.lineHeight * fontSizeMult;

  return {
    text: '',
    graphemes: [],
    width: 0,
    height,
    bounds: [],
    isWrapped: false,
    isLastInParagraph: true,
    baseline: height * 0.8,
  };
}

/**
 * Measure width of a line of text
 */
function measureLineWidth(text: string, options: TextLayoutOptions): number {
  const graphemes = segmentGraphemes(text);
  const measurementOptions = createMeasurementOptions(options);
  
  let width = 0;
  for (let i = 0; i < graphemes.length; i++) {
    const grapheme = graphemes[i];
    const prevGrapheme = i > 0 ? graphemes[i - 1] : undefined;
    
    const measurement = measureGraphemeWithKerning(
      grapheme,
      prevGrapheme, 
      measurementOptions
    );
    
    const letterSpacing = options.letterSpacing || 0;
    const charSpacing = options.charSpacing ? 
      (options.fontSize * options.charSpacing) / 1000 : 0;
    
    width += measurement.kernedWidth + letterSpacing + charSpacing;
  }
  
  return width;
}

/**
 * Convert layout options to measurement options
 */
function createMeasurementOptions(options: TextLayoutOptions): MeasurementOptions {
  return {
    fontFamily: options.fontFamily,
    fontSize: options.fontSize,
    fontStyle: options.fontStyle,
    fontWeight: options.fontWeight,
    letterSpacing: options.letterSpacing,
    direction: options.direction === 'inherit' ? 'ltr' : options.direction,
  };
}