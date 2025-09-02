/**
 * Browser Line Break Extraction
 * 
 * Captures exact line breaks as rendered by the browser to ensure
 * pixel-perfect consistency between DOM editing and canvas rendering.
 */

export interface BrowserLine {
  text: string;
  start: number; // character index in original text
  end: number;   // character index in original text (exclusive)
}

export interface BrowserLinesResult {
  lines: BrowserLine[];
  totalWidth: number;
  totalHeight: number;
}

/**
 * Segment text into graphemes safely using Intl.Segmenter or fallback
 */
function segmentIntoGraphemes(text: string): string[] {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return Array.from(segmenter.segment(text), s => s.segment);
  }
  
  // Fallback: Use Array.from which handles basic Unicode correctly
  return Array.from(text);
}

/**
 * Extract line break information from a textarea by creating a mirror element
 * with identical computed styles and measuring grapheme positions.
 */
export function extractLinesFromDOM(textarea: HTMLTextAreaElement): BrowserLinesResult {
  const text = textarea.value;
  if (!text) {
    return {
      lines: [],
      totalWidth: 0,
      totalHeight: 0
    };
  }

  // Get computed styles from the textarea
  const computedStyle = getComputedStyle(textarea);
  const container = textarea.parentElement;
  if (!container) {
    throw new Error('Textarea must be in DOM to extract lines');
  }

  // Create mirror div with identical styling
  const mirror = document.createElement('div');
  mirror.style.position = 'absolute';
  mirror.style.left = '-9999px';
  mirror.style.top = '-9999px';
  mirror.style.visibility = 'hidden';
  mirror.style.pointerEvents = 'none';
  
  // Copy all relevant text styling
  const stylesToCopy = [
    'fontSize',
    'fontFamily',
    'fontWeight',
    'fontStyle',
    'lineHeight',
    'letterSpacing',
    'wordSpacing',
    'textAlign',
    'textTransform',
    'whiteSpace',
    'overflowWrap',
    'wordBreak',
    'direction',
    'unicodeBidi',
    'width',
    'height',
    'maxWidth',
    'maxHeight',
    'minWidth',
    'minHeight',
    'padding',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'border',
    'borderTop',
    'borderRight',
    'borderBottom',
    'borderLeft',
    'boxSizing',
  ];
  
  stylesToCopy.forEach(prop => {
    (mirror.style as any)[prop] = (computedStyle as any)[prop];
  });

  // Ensure the mirror has the same dimensions and overflow behavior as textarea
  mirror.style.overflow = 'hidden';
  mirror.style.resize = 'none';

  container.appendChild(mirror);

  try {
    // Segment text into graphemes
    const graphemes = segmentIntoGraphemes(text);
    const spans: HTMLSpanElement[] = [];
    
    // Create a span for each grapheme
    graphemes.forEach((grapheme, index) => {
      const span = document.createElement('span');
      span.textContent = grapheme;
      span.setAttribute('data-index', index.toString());
      mirror.appendChild(span);
      spans.push(span);
    });

    // Group spans by their offsetTop (line position)
    const lineGroups = new Map<number, { spans: HTMLSpanElement[], indices: number[] }>();
    
    spans.forEach((span, index) => {
      const top = span.offsetTop;
      if (!lineGroups.has(top)) {
        lineGroups.set(top, { spans: [], indices: [] });
      }
      lineGroups.get(top)!.spans.push(span);
      lineGroups.get(top)!.indices.push(index);
    });

    // Convert line groups to BrowserLine objects
    const lines: BrowserLine[] = [];
    const sortedTops = Array.from(lineGroups.keys()).sort((a, b) => a - b);
    
    sortedTops.forEach(top => {
      const group = lineGroups.get(top)!;
      const sortedIndices = group.indices.sort((a, b) => a - b);
      
      const start = sortedIndices[0];
      const end = sortedIndices[sortedIndices.length - 1] + 1;
      const lineText = graphemes.slice(start, end).join('');
      
      lines.push({
        text: lineText,
        start,
        end,
      });
    });

    // Calculate total dimensions
    const totalWidth = Math.max(...spans.map(span => span.offsetLeft + span.offsetWidth));
    const totalHeight = spans.length > 0 ? 
      Math.max(...spans.map(span => span.offsetTop + span.offsetHeight)) : 0;

    return {
      lines,
      totalWidth,
      totalHeight
    };
    
  } finally {
    // Clean up mirror element
    container.removeChild(mirror);
  }
}

/**
 * Create a hash of layout-affecting properties to detect when browser lines are still valid
 */
export function createLayoutHash(target: any): string {
  const properties = [
    target.text,
    target.width,
    target.height,
    target.fontFamily,
    target.fontSize,
    target.fontWeight,
    target.fontStyle,
    target.lineHeight,
    target.charSpacing,
    target.textAlign,
    target.direction,
  ];
  
  return properties.map(p => String(p)).join('|');
}

/**
 * Check if stored browser lines are still valid for the current target state
 */
export function areBrowserLinesValid(target: any, storedHash?: string): boolean {
  if (!storedHash || !(target as any).__lastBrowserLines) {
    return false;
  }
  
  const currentHash = createLayoutHash(target);
  return currentHash === storedHash;
}

/**
 * Store browser lines on a target object with validity hash
 */
export function storeBrowserLines(
  target: any, 
  lines: BrowserLine[], 
  layoutHash?: string
): void {
  (target as any).__lastBrowserLines = lines;
  (target as any).__lastBrowserLinesHash = layoutHash || createLayoutHash(target);
}

/**
 * Clear stored browser lines from a target object
 */
export function clearBrowserLines(target: any): void {
  delete (target as any).__lastBrowserLines;
  delete (target as any).__lastBrowserLinesHash;
}

/**
 * Get stored browser lines if they're still valid
 */
export function getBrowserLines(target: any): BrowserLine[] | null {
  const lines = (target as any).__lastBrowserLines;
  const hash = (target as any).__lastBrowserLinesHash;
  
  if (lines && areBrowserLinesValid(target, hash)) {
    return lines;
  }
  
  return null;
}