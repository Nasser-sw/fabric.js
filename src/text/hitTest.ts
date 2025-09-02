/**
 * Hit Testing and Cursor Positioning System
 * 
 * Maps pointer coordinates to text positions and provides cursor rectangles
 * for interactive text editing with grapheme-aware boundaries.
 */

import type { LayoutResult, LayoutLine, GraphemeBounds } from './layout';
import type { TextLayoutOptions } from './layout';
import { segmentGraphemes } from './unicode';

export interface HitTestResult {
  lineIndex: number;
  charIndex: number;
  graphemeIndex: number;
  isAtLineEnd: boolean;
  isAtTextEnd: boolean;
  insertionIndex: number; // For cursor positioning
  closestBound?: GraphemeBounds;
}

export interface CursorRect {
  x: number;
  y: number;
  width: number;
  height: number;
  baseline: number;
}

export interface SelectionRect extends CursorRect {
  lineIndex: number;
  startIndex: number;
  endIndex: number;
}

/**
 * Hit test a point against laid out text to find insertion position
 */
export function hitTest(
  x: number,
  y: number,
  layout: LayoutResult,
  options: TextLayoutOptions
): HitTestResult {
  if (layout.lines.length === 0) {
    return {
      lineIndex: 0,
      charIndex: 0,
      graphemeIndex: 0,
      isAtLineEnd: true,
      isAtTextEnd: true,
      insertionIndex: 0,
    };
  }

  // Find the line containing the y coordinate
  const lineResult = findLineAtY(y, layout.lines);
  const line = layout.lines[lineResult.lineIndex];
  
  if (!line || line.bounds.length === 0) {
    return {
      lineIndex: lineResult.lineIndex,
      charIndex: 0,
      graphemeIndex: 0,
      isAtLineEnd: true,
      isAtTextEnd: lineResult.lineIndex >= layout.lines.length - 1,
      insertionIndex: calculateInsertionIndex(lineResult.lineIndex, 0, layout),
    };
  }

  // Find the character position within the line
  const charResult = findCharAtX(x, line, options);
  
  // Calculate total insertion index
  const insertionIndex = calculateInsertionIndex(
    lineResult.lineIndex, 
    charResult.graphemeIndex, 
    layout
  );

  return {
    lineIndex: lineResult.lineIndex,
    charIndex: charResult.charIndex,
    graphemeIndex: charResult.graphemeIndex,
    isAtLineEnd: charResult.isAtLineEnd,
    isAtTextEnd: lineResult.lineIndex >= layout.lines.length - 1 && charResult.isAtLineEnd,
    insertionIndex,
    closestBound: charResult.closestBound,
  };
}

/**
 * Get cursor rectangle for a given insertion index
 */
export function getCursorRect(
  insertionIndex: number,
  layout: LayoutResult,
  options: TextLayoutOptions
): CursorRect {
  if (layout.lines.length === 0) {
    return {
      x: 0,
      y: 0,
      width: 2, // Default cursor width
      height: options.fontSize,
      baseline: options.fontSize * 0.8,
    };
  }

  const position = findPositionFromIndex(insertionIndex, layout);
  const line = layout.lines[position.lineIndex];

  if (!line) {
    // Past end of text
    const lastLine = layout.lines[layout.lines.length - 1];
    return {
      x: lastLine.width,
      y: (layout.lines.length - 1) * (options.fontSize * options.lineHeight),
      width: 2,
      height: options.fontSize * options.lineHeight,
      baseline: options.fontSize * 0.8,
    };
  }

  // Get position within line
  let x = 0;
  if (position.graphemeIndex > 0 && line.bounds.length > 0) {
    const boundIndex = Math.min(position.graphemeIndex - 1, line.bounds.length - 1);
    const bound = line.bounds[boundIndex];
    x = bound.x + bound.kernedWidth;
  }

  const y = calculateLineY(position.lineIndex, layout, options);

  return {
    x,
    y,
    width: 2, // Standard cursor width
    height: line.height,
    baseline: y + line.baseline,
  };
}

/**
 * Get selection rectangles for a range of text
 */
export function getSelectionRects(
  startIndex: number,
  endIndex: number,
  layout: LayoutResult,
  options: TextLayoutOptions
): SelectionRect[] {
  if (startIndex >= endIndex || layout.lines.length === 0) {
    return [];
  }

  const startPos = findPositionFromIndex(startIndex, layout);
  const endPos = findPositionFromIndex(endIndex, layout);
  const rects: SelectionRect[] = [];

  // Handle selection across multiple lines
  for (let lineIndex = startPos.lineIndex; lineIndex <= endPos.lineIndex; lineIndex++) {
    const line = layout.lines[lineIndex];
    if (!line) continue;

    // Determine start and end positions within this line
    const lineStartIndex = lineIndex === startPos.lineIndex ? startPos.graphemeIndex : 0;
    const lineEndIndex = lineIndex === endPos.lineIndex 
      ? endPos.graphemeIndex 
      : line.graphemes.length;

    if (lineStartIndex >= lineEndIndex) continue;

    // Calculate selection rectangle for this line
    const rect = getLineSelectionRect(
      line,
      lineIndex,
      lineStartIndex,
      lineEndIndex,
      layout,
      options
    );

    if (rect) {
      rects.push(rect);
    }
  }

  return rects;
}

/**
 * Get grapheme boundaries for text navigation
 */
export function getGraphemeBoundaries(text: string): number[] {
  const graphemes = segmentGraphemes(text);
  const boundaries: number[] = [0];
  let stringIndex = 0;

  for (const grapheme of graphemes) {
    stringIndex += grapheme.length;
    boundaries.push(stringIndex);
  }

  return boundaries;
}

/**
 * Map string index to grapheme index
 */
export function mapStringIndexToGraphemeIndex(text: string, stringIndex: number): number {
  const graphemes = segmentGraphemes(text);
  let currentStringIndex = 0;

  for (let i = 0; i < graphemes.length; i++) {
    if (currentStringIndex >= stringIndex) {
      return i;
    }
    currentStringIndex += graphemes[i].length;
  }

  return graphemes.length;
}

/**
 * Map grapheme index to string index
 */
export function mapGraphemeIndexToStringIndex(text: string, graphemeIndex: number): number {
  const graphemes = segmentGraphemes(text);
  let stringIndex = 0;

  for (let i = 0; i < graphemeIndex && i < graphemes.length; i++) {
    stringIndex += graphemes[i].length;
  }

  return stringIndex;
}

// Private helper functions

/**
 * Find which line contains the given Y coordinate
 */
function findLineAtY(y: number, lines: LayoutLine[]): { lineIndex: number; offsetY: number } {
  let currentY = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (y >= currentY && y < currentY + line.height) {
      return { lineIndex: i, offsetY: y - currentY };
    }
    currentY += line.height;
  }

  // Y is past all lines - return last line
  return { 
    lineIndex: lines.length - 1, 
    offsetY: lines[lines.length - 1]?.height || 0 
  };
}

/**
 * Find character position within a line at given X coordinate
 */
function findCharAtX(
  x: number,
  line: LayoutLine,
  options: TextLayoutOptions
): {
  charIndex: number;
  graphemeIndex: number;
  isAtLineEnd: boolean;
  closestBound?: GraphemeBounds;
} {
  if (line.bounds.length === 0) {
    return {
      charIndex: 0,
      graphemeIndex: 0,
      isAtLineEnd: true,
    };
  }

  // Create visual ordering: sort bounds by visual X position (left-to-right)
  // This handles mixed LTR/RTL content where visual order != logical order
  const visualBounds = line.bounds.map((bound, logicalIndex) => ({
    bound,
    logicalIndex,
    visualX: bound.x,
    visualXEnd: bound.x + bound.kernedWidth,
  })).sort((a, b) => a.visualX - b.visualX);

  // Find leftmost and rightmost visual positions
  const leftmostX = visualBounds[0].visualX;
  const rightmostX = visualBounds[visualBounds.length - 1].visualXEnd;

  // Handle clicks before the line starts
  if (x < leftmostX) {
    // Find the character that appears visually first
    const firstVisualBound = visualBounds[0];
    return {
      charIndex: firstVisualBound.bound.charIndex,
      graphemeIndex: firstVisualBound.bound.graphemeIndex,
      isAtLineEnd: false,
      closestBound: firstVisualBound.bound,
    };
  }

  // Handle clicks after the line ends
  if (x >= rightmostX) {
    // Find the character that appears visually last
    const lastVisualBound = visualBounds[visualBounds.length - 1];
    return {
      charIndex: lastVisualBound.bound.charIndex + 1,
      graphemeIndex: lastVisualBound.bound.graphemeIndex + 1,
      isAtLineEnd: true,
      closestBound: lastVisualBound.bound,
    };
  }

  // Find the character containing the X coordinate
  for (let i = 0; i < visualBounds.length; i++) {
    const { bound, visualX, visualXEnd } = visualBounds[i];
    
    if (x >= visualX && x < visualXEnd) {
      // Determine if closer to start or end of character
      const midpoint = visualX + (visualXEnd - visualX) / 2;
      const insertBeforeChar = x < midpoint;
      
      if (insertBeforeChar) {
        return {
          charIndex: bound.charIndex,
          graphemeIndex: bound.graphemeIndex,
          isAtLineEnd: false,
          closestBound: bound,
        };
      } else {
        // Insert after this character
        return {
          charIndex: bound.charIndex + 1,
          graphemeIndex: bound.graphemeIndex + 1,
          isAtLineEnd: false,
          closestBound: bound,
        };
      }
    }
    
    // Check if x is in the gap between this character and the next
    if (i < visualBounds.length - 1) {
      const nextVisual = visualBounds[i + 1];
      if (x >= visualXEnd && x < nextVisual.visualX) {
        // Click in gap - place cursor after current character
        return {
          charIndex: bound.charIndex + 1,
          graphemeIndex: bound.graphemeIndex + 1,
          isAtLineEnd: false,
          closestBound: bound,
        };
      }
    }
  }

  // Fallback - find closest character
  const closestBound = visualBounds.reduce((closest, current) => {
    const closestDistance = Math.abs((closest.visualX + closest.visualXEnd) / 2 - x);
    const currentDistance = Math.abs((current.visualX + current.visualXEnd) / 2 - x);
    return currentDistance < closestDistance ? current : closest;
  });

  return {
    charIndex: closestBound.bound.charIndex,
    graphemeIndex: closestBound.bound.graphemeIndex,
    isAtLineEnd: false,
    closestBound: closestBound.bound,
  };
}

/**
 * Calculate total insertion index from line and character indices
 */
function calculateInsertionIndex(
  lineIndex: number,
  graphemeIndex: number,
  layout: LayoutResult
): number {
  let insertionIndex = 0;

  // Add characters from all previous lines
  for (let i = 0; i < lineIndex && i < layout.lines.length; i++) {
    insertionIndex += layout.lines[i].graphemes.length;
    // Add newline character (except for last line)
    if (i < layout.lines.length - 1) {
      insertionIndex += 1; // \n character
    }
  }

  // Add characters within current line
  insertionIndex += graphemeIndex;

  return insertionIndex;
}

/**
 * Find line and grapheme position from insertion index
 */
function findPositionFromIndex(
  insertionIndex: number,
  layout: LayoutResult
): { lineIndex: number; graphemeIndex: number } {
  let currentIndex = 0;

  for (let lineIndex = 0; lineIndex < layout.lines.length; lineIndex++) {
    const line = layout.lines[lineIndex];
    const lineLength = line.graphemes.length;

    // Check if index is within this line
    if (insertionIndex >= currentIndex && insertionIndex <= currentIndex + lineLength) {
      return {
        lineIndex,
        graphemeIndex: insertionIndex - currentIndex,
      };
    }

    // Move to next line
    currentIndex += lineLength;
    
    // Add newline character (except after last line)
    if (lineIndex < layout.lines.length - 1) {
      currentIndex += 1; // \n character
      
      // If insertion index is exactly at the newline
      if (insertionIndex === currentIndex - 1) {
        return {
          lineIndex,
          graphemeIndex: lineLength,
        };
      }
    }
  }

  // Index is past end of text
  const lastLineIndex = layout.lines.length - 1;
  const lastLine = layout.lines[lastLineIndex];
  
  return {
    lineIndex: lastLineIndex,
    graphemeIndex: lastLine ? lastLine.graphemes.length : 0,
  };
}

/**
 * Calculate Y position of a line
 */
function calculateLineY(
  lineIndex: number,
  layout: LayoutResult,
  options: TextLayoutOptions
): number {
  let y = 0;

  for (let i = 0; i < lineIndex && i < layout.lines.length; i++) {
    y += layout.lines[i].height;
  }

  return y;
}

/**
 * Get selection rectangle for a portion of a line
 */
function getLineSelectionRect(
  line: LayoutLine,
  lineIndex: number,
  startGraphemeIndex: number,
  endGraphemeIndex: number,
  layout: LayoutResult,
  options: TextLayoutOptions
): SelectionRect | null {
  if (startGraphemeIndex >= endGraphemeIndex || line.bounds.length === 0) {
    return null;
  }

  // Calculate start X
  let startX = 0;
  if (startGraphemeIndex > 0 && startGraphemeIndex <= line.bounds.length) {
    const startBound = line.bounds[startGraphemeIndex - 1];
    startX = startBound.x + startBound.kernedWidth;
  }

  // Calculate end X
  let endX = line.width;
  if (endGraphemeIndex > 0 && endGraphemeIndex <= line.bounds.length) {
    const endBound = line.bounds[endGraphemeIndex - 1];
    endX = endBound.x + endBound.kernedWidth;
  }

  const y = calculateLineY(lineIndex, layout, options);

  return {
    x: Math.min(startX, endX),
    y,
    width: Math.abs(endX - startX),
    height: line.height,
    baseline: y + line.baseline,
    lineIndex,
    startIndex: startGraphemeIndex,
    endIndex: endGraphemeIndex,
  };
}

/**
 * Get word boundaries for double-click selection
 */
export function getWordBoundaries(
  text: string,
  graphemeIndex: number
): { start: number; end: number } {
  const graphemes = segmentGraphemes(text);
  
  if (graphemeIndex >= graphemes.length) {
    return { start: graphemes.length, end: graphemes.length };
  }

  // Find word boundaries
  let start = graphemeIndex;
  let end = graphemeIndex;

  // Expand backwards to find word start
  while (start > 0 && !isWordBoundary(graphemes[start - 1])) {
    start--;
  }

  // Expand forwards to find word end
  while (end < graphemes.length && !isWordBoundary(graphemes[end])) {
    end++;
  }

  return { start, end };
}

/**
 * Get line boundaries for triple-click selection
 */
export function getLineBoundaries(
  insertionIndex: number,
  layout: LayoutResult
): { start: number; end: number } {
  const position = findPositionFromIndex(insertionIndex, layout);
  const line = layout.lines[position.lineIndex];
  
  if (!line) {
    return { start: insertionIndex, end: insertionIndex };
  }

  // Calculate line start and end indices
  const lineStart = calculateInsertionIndex(position.lineIndex, 0, layout);
  const lineEnd = calculateInsertionIndex(
    position.lineIndex, 
    line.graphemes.length, 
    layout
  );

  return { start: lineStart, end: lineEnd };
}

/**
 * Check if a character is a word boundary
 */
function isWordBoundary(grapheme: string): boolean {
  return /\s/.test(grapheme) || /[^\w]/.test(grapheme);
}

/**
 * Find closest cursor position to a point (for drag operations)
 */
export function findClosestCursorPosition(
  x: number,
  y: number,
  layout: LayoutResult,
  options: TextLayoutOptions
): number {
  const hitResult = hitTest(x, y, layout, options);
  return hitResult.insertionIndex;
}

/**
 * Get bounding box for a range of text
 */
export function getTextRangeBounds(
  startIndex: number,
  endIndex: number,
  layout: LayoutResult,
  options: TextLayoutOptions
): {
  x: number;
  y: number;
  width: number;
  height: number;
  rects: SelectionRect[];
} {
  const rects = getSelectionRects(startIndex, endIndex, layout, options);
  
  if (rects.length === 0) {
    return {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      rects: [],
    };
  }

  const minX = Math.min(...rects.map(r => r.x));
  const maxX = Math.max(...rects.map(r => r.x + r.width));
  const minY = Math.min(...rects.map(r => r.y));
  const maxY = Math.max(...rects.map(r => r.y + r.height));

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    rects,
  };
}