/**
 * Ellipsis Text Truncation System
 * 
 * Implements text truncation with ellipsis when content exceeds bounds,
 * using binary search for optimal truncation points.
 */

import { segmentGraphemes } from './unicode';

export interface EllipsisOptions {
  maxWidth?: number;
  maxHeight?: number;
  ellipsisChar: string; // Default: "…"
  measureFn: (text: string) => number | { width: number; height: number };
}

export interface EllipsisResult {
  truncatedText: string;
  isTruncated: boolean;
  truncationIndex: number; // Grapheme index where truncation occurred
  ellipsisWidth: number;
  originalLength: number;
}

/**
 * Apply ellipsis truncation to text based on width/height constraints
 */
export function applyEllipsis(
  text: string,
  options: EllipsisOptions
): EllipsisResult {
  const { maxWidth, maxHeight, ellipsisChar, measureFn } = options;
  
  if (!text) {
    return {
      truncatedText: '',
      isTruncated: false,
      truncationIndex: 0,
      ellipsisWidth: 0,
      originalLength: 0,
    };
  }

  // Measure ellipsis width
  const ellipsisWidth = typeof measureFn(ellipsisChar) === 'number' 
    ? measureFn(ellipsisChar) as number
    : (measureFn(ellipsisChar) as { width: number }).width;

  // Check if truncation is needed
  const originalMeasurement = measureFn(text);
  const originalWidth = typeof originalMeasurement === 'number' 
    ? originalMeasurement 
    : originalMeasurement.width;
  const originalHeight = typeof originalMeasurement === 'number'
    ? 0 // Height constraint not applicable for single dimension measure
    : originalMeasurement.height;

  let needsTruncation = false;
  if (maxWidth && originalWidth > maxWidth) needsTruncation = true;
  if (maxHeight && originalHeight > maxHeight) needsTruncation = true;

  if (!needsTruncation) {
    return {
      truncatedText: text,
      isTruncated: false,
      truncationIndex: segmentGraphemes(text).length,
      ellipsisWidth,
      originalLength: segmentGraphemes(text).length,
    };
  }

  // Apply width-based truncation
  if (maxWidth) {
    const widthTruncated = truncateByWidth(text, maxWidth, ellipsisChar, ellipsisWidth, measureFn);
    return {
      ...widthTruncated,
      ellipsisWidth,
      originalLength: segmentGraphemes(text).length,
    };
  }

  // Apply height-based truncation (for multi-line text)
  if (maxHeight) {
    const heightTruncated = truncateByHeight(text, maxHeight, ellipsisChar, measureFn);
    return {
      ...heightTruncated,
      ellipsisWidth,
      originalLength: segmentGraphemes(text).length,
    };
  }

  // Fallback - should not reach here
  return {
    truncatedText: text,
    isTruncated: false,
    truncationIndex: segmentGraphemes(text).length,
    ellipsisWidth,
    originalLength: segmentGraphemes(text).length,
  };
}

/**
 * Truncate text based on width constraint using binary search
 */
function truncateByWidth(
  text: string,
  maxWidth: number,
  ellipsisChar: string,
  ellipsisWidth: number,
  measureFn: (text: string) => number | { width: number; height: number }
): Omit<EllipsisResult, 'ellipsisWidth' | 'originalLength'> {
  const graphemes = segmentGraphemes(text);
  const availableWidth = maxWidth - ellipsisWidth;

  // Binary search for optimal truncation point
  let low = 0;
  let high = graphemes.length;
  let bestFit = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = graphemes.slice(0, mid).join('');
    
    const measurement = measureFn(candidate);
    const candidateWidth = typeof measurement === 'number' 
      ? measurement 
      : measurement.width;

    if (candidateWidth <= availableWidth) {
      bestFit = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  // Handle edge cases
  if (bestFit === 0) {
    // Even single character doesn't fit - return ellipsis only
    return {
      truncatedText: ellipsisChar,
      isTruncated: true,
      truncationIndex: 0,
    };
  }

  if (bestFit === graphemes.length) {
    // Everything fits even with ellipsis space reserved
    return {
      truncatedText: text,
      isTruncated: false,
      truncationIndex: graphemes.length,
    };
  }

  // Create truncated text with ellipsis
  const truncatedText = graphemes.slice(0, bestFit).join('') + ellipsisChar;

  return {
    truncatedText,
    isTruncated: true,
    truncationIndex: bestFit,
  };
}

/**
 * Truncate text based on height constraint
 */
function truncateByHeight(
  text: string,
  maxHeight: number,
  ellipsisChar: string,
  measureFn: (text: string) => number | { width: number; height: number }
): Omit<EllipsisResult, 'ellipsisWidth' | 'originalLength'> {
  const lines = text.split('\n');
  let accumulatedText = '';
  let lineIndex = 0;

  // Add lines until height exceeded
  for (lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const testText = lineIndex === 0 
      ? lines[lineIndex] 
      : accumulatedText + '\n' + lines[lineIndex];
    
    const measurement = measureFn(testText);
    const height = typeof measurement === 'number' 
      ? 0 // Single dimension measure doesn't provide height
      : measurement.height;

    if (height > maxHeight && accumulatedText) {
      // Previous text fits, current doesn't - truncate at previous
      break;
    }

    accumulatedText = testText;

    // If this is the last line and it fits, no truncation needed
    if (lineIndex === lines.length - 1) {
      return {
        truncatedText: text,
        isTruncated: false,
        truncationIndex: segmentGraphemes(text).length,
      };
    }
  }

  // If we need to truncate the last fitting line to add ellipsis
  if (lineIndex > 0) {
    const lastFittingLine = lines[lineIndex - 1];
    const withEllipsis = lastFittingLine + ellipsisChar;
    const graphemes = segmentGraphemes(accumulatedText);

    return {
      truncatedText: accumulatedText.replace(/[^\n]*$/, withEllipsis),
      isTruncated: true,
      truncationIndex: graphemes.length - segmentGraphemes(lastFittingLine).length + segmentGraphemes(withEllipsis).length - 1,
    };
  }

  // First line doesn't fit - try width-based truncation on first line
  const firstLineWidth = typeof measureFn === 'function' 
    ? (measureFn(lines[0]) as any)?.width || 1000
    : 1000; // Fallback width

  return truncateByWidth(lines[0], firstLineWidth, ellipsisChar, 0, measureFn);
}

/**
 * Find optimal truncation point using binary search
 */
export function findTruncationPoint(
  text: string,
  maxWidth: number,
  ellipsisWidth: number,
  measureFn: (text: string) => number
): number {
  const graphemes = segmentGraphemes(text);
  const availableWidth = maxWidth - ellipsisWidth;

  let low = 0;
  let high = graphemes.length;

  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    const candidate = graphemes.slice(0, mid).join('');
    const width = measureFn(candidate);

    if (width <= availableWidth) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return low;
}

/**
 * Smart truncation that tries to break at word boundaries
 */
export function smartTruncate(
  text: string,
  maxWidth: number,
  ellipsisChar: string,
  measureFn: (text: string) => number
): EllipsisResult {
  const ellipsisWidth = measureFn(ellipsisChar);
  const availableWidth = maxWidth - ellipsisWidth;
  
  // First try exact truncation
  const exactPoint = findTruncationPoint(text, maxWidth, ellipsisWidth, measureFn);
  const graphemes = segmentGraphemes(text);
  
  if (exactPoint === 0) {
    return {
      truncatedText: ellipsisChar,
      isTruncated: true,
      truncationIndex: 0,
      ellipsisWidth,
      originalLength: graphemes.length,
    };
  }

  if (exactPoint >= graphemes.length) {
    return {
      truncatedText: text,
      isTruncated: false,
      truncationIndex: graphemes.length,
      ellipsisWidth,
      originalLength: graphemes.length,
    };
  }

  // Try to find a word boundary before the exact point
  const textUpToPoint = graphemes.slice(0, exactPoint).join('');
  const words = textUpToPoint.split(/(\s+)/);
  
  if (words.length > 1) {
    // Try truncating at last complete word
    const wordsWithoutLast = words.slice(0, -2); // Remove last word and space
    const wordBoundaryText = wordsWithoutLast.join('');
    const wordBoundaryWidth = measureFn(wordBoundaryText);
    
    if (wordBoundaryWidth + ellipsisWidth <= maxWidth && wordBoundaryText.trim()) {
      const wordBoundaryGraphemes = segmentGraphemes(wordBoundaryText);
      return {
        truncatedText: wordBoundaryText.trim() + ellipsisChar,
        isTruncated: true,
        truncationIndex: wordBoundaryGraphemes.length,
        ellipsisWidth,
        originalLength: graphemes.length,
      };
    }
  }

  // Fall back to character truncation
  return {
    truncatedText: graphemes.slice(0, exactPoint).join('') + ellipsisChar,
    isTruncated: true,
    truncationIndex: exactPoint,
    ellipsisWidth,
    originalLength: graphemes.length,
  };
}

/**
 * Truncate multi-line text with ellipsis on the last visible line
 */
export function truncateMultiline(
  lines: string[],
  maxLines: number,
  ellipsisChar: string,
  maxWidth?: number,
  measureFn?: (text: string) => number
): {
  truncatedLines: string[];
  isTruncated: boolean;
  lastLineIndex: number;
} {
  if (lines.length <= maxLines) {
    return {
      truncatedLines: lines,
      isTruncated: false,
      lastLineIndex: lines.length - 1,
    };
  }

  // Take lines up to limit
  const visibleLines = lines.slice(0, maxLines);
  
  // Add ellipsis to last line if needed
  if (maxWidth && measureFn) {
    const lastLineIndex = visibleLines.length - 1;
    const lastLine = visibleLines[lastLineIndex];
    const lastLineWithEllipsis = lastLine + ellipsisChar;
    
    if (measureFn(lastLineWithEllipsis) > maxWidth) {
      // Last line + ellipsis doesn't fit, truncate it
      const ellipsisWidth = measureFn(ellipsisChar);
      const truncationPoint = findTruncationPoint(lastLine, maxWidth, ellipsisWidth, measureFn);
      const graphemes = segmentGraphemes(lastLine);
      visibleLines[lastLineIndex] = graphemes.slice(0, truncationPoint).join('') + ellipsisChar;
    } else {
      visibleLines[lastLineIndex] = lastLineWithEllipsis;
    }
  } else {
    // Just add ellipsis to last line
    const lastLineIndex = visibleLines.length - 1;
    visibleLines[lastLineIndex] = visibleLines[lastLineIndex] + ellipsisChar;
  }

  return {
    truncatedLines: visibleLines,
    isTruncated: true,
    lastLineIndex: maxLines - 1,
  };
}

/**
 * Calculate ellipsis positioning for different alignments
 */
export function getEllipsisPosition(
  text: string,
  position: 'end' | 'middle' | 'start',
  maxWidth: number,
  ellipsisChar: string,
  measureFn: (text: string) => number
): EllipsisResult {
  const ellipsisWidth = measureFn(ellipsisChar);
  const graphemes = segmentGraphemes(text);
  const totalWidth = measureFn(text);
  
  if (totalWidth <= maxWidth) {
    return {
      truncatedText: text,
      isTruncated: false,
      truncationIndex: graphemes.length,
      ellipsisWidth,
      originalLength: graphemes.length,
    };
  }

  switch (position) {
    case 'start':
      return truncateFromStart(text, maxWidth, ellipsisChar, measureFn);
    case 'middle':
      return truncateFromMiddle(text, maxWidth, ellipsisChar, measureFn);
    case 'end':
    default:
      return smartTruncate(text, maxWidth, ellipsisChar, measureFn);
  }
}

/**
 * Truncate from start with ellipsis at beginning
 */
function truncateFromStart(
  text: string,
  maxWidth: number,
  ellipsisChar: string,
  measureFn: (text: string) => number
): EllipsisResult {
  const ellipsisWidth = measureFn(ellipsisChar);
  const graphemes = segmentGraphemes(text);
  const availableWidth = maxWidth - ellipsisWidth;

  let low = 0;
  let high = graphemes.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = graphemes.slice(mid).join('');
    const width = measureFn(candidate);

    if (width <= availableWidth) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }

  if (low >= graphemes.length) {
    return {
      truncatedText: ellipsisChar,
      isTruncated: true,
      truncationIndex: 0,
      ellipsisWidth,
      originalLength: graphemes.length,
    };
  }

  return {
    truncatedText: ellipsisChar + graphemes.slice(low).join(''),
    isTruncated: true,
    truncationIndex: low,
    ellipsisWidth,
    originalLength: graphemes.length,
  };
}

/**
 * Truncate from middle with ellipsis in center
 */
function truncateFromMiddle(
  text: string,
  maxWidth: number,
  ellipsisChar: string,
  measureFn: (text: string) => number
): EllipsisResult {
  const ellipsisWidth = measureFn(ellipsisChar);
  const graphemes = segmentGraphemes(text);
  const availableWidth = maxWidth - ellipsisWidth;

  // Binary search for optimal split
  let low = 0;
  let high = Math.floor(graphemes.length / 2);

  while (low < high) {
    const startChars = Math.floor((low + high + 1) / 2);
    const endChars = startChars;
    
    const candidate = graphemes.slice(0, startChars).join('') + 
                     graphemes.slice(-endChars).join('');
    const width = measureFn(candidate);

    if (width <= availableWidth) {
      low = startChars;
    } else {
      high = startChars - 1;
    }
  }

  const startChars = low;
  const endChars = low;

  if (startChars + endChars >= graphemes.length) {
    return {
      truncatedText: text,
      isTruncated: false,
      truncationIndex: graphemes.length,
      ellipsisWidth,
      originalLength: graphemes.length,
    };
  }

  const truncatedText = graphemes.slice(0, startChars).join('') + 
                       ellipsisChar + 
                       graphemes.slice(-endChars).join('');

  return {
    truncatedText,
    isTruncated: true,
    truncationIndex: startChars,
    ellipsisWidth,
    originalLength: graphemes.length,
  };
}