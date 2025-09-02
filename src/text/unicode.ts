/**
 * Unicode and Internationalization Support
 * 
 * Enhanced Unicode handling for complex scripts, RTL/LTR text,
 * and grapheme cluster boundary detection.
 */

import { graphemeSplit } from '../util/lang_string';

export interface BiDiRun {
  text: string;
  direction: 'ltr' | 'rtl';
  level: number;
  start: number;
  end: number;
}

export interface ScriptInfo {
  script: string;
  direction: 'ltr' | 'rtl';
  needsShaping: boolean;
  complexLayout: boolean;
}

// Unicode character categories for text processing
const UNICODE_CATEGORIES = {
  // Bidirectional types
  L: /[\u0041-\u005A\u0061-\u007A\u00AA\u00B5\u00BA\u00C0-\u00D6\u00D8-\u00F6]/,
  R: /[\u05BE\u05C0\u05C3\u05C6\u05D0-\u05EA\u05F0-\u05F4\u0608\u060B\u060D]/,
  AL: /[\u0627\u0629-\u063A\u0641-\u064A\u066D-\u066F\u0671-\u06D3\u06D5]/,
  EN: /[\u0030-\u0039\u00B2\u00B3\u00B9\u06F0-\u06F9]/,
  ES: /[\u002B\u002D]/,
  ET: /[\u0023\u0024\u0025\u00A2\u00A3\u00A4\u00A5]/,
  AN: /[\u0660-\u0669\u066B\u066C]/,
  CS: /[\u002C\u002E\u002F\u003A\u00A0]/,
  NSM: /[\u0300-\u036F\u0483-\u0489\u0591-\u05BD\u05BF\u05C1\u05C2]/,
  BN: /[\u0000-\u0008\u000E-\u001B\u007F-\u0084\u0086-\u009F]/,
  B: /[\u000A\u000D\u001C-\u001E\u0085\u2029]/,
  S: /[\u0009\u000B\u001F]/,
  WS: /[\u000C\u0020\u1680\u2000-\u200A\u2028\u205F\u3000]/,
  ON: /[\u0021\u0022\u0026-\u002A\u003B-\u0040\u005B-\u0060\u007B-\u007E]/,
};

// Script detection patterns
const SCRIPT_PATTERNS = {
  latin: /[\u0041-\u005A\u0061-\u007A\u00C0-\u024F]/,
  arabic: /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/,
  hebrew: /[\u0590-\u05FF]/,
  cyrillic: /[\u0400-\u04FF\u0500-\u052F]/,
  greek: /[\u0370-\u03FF\u1F00-\u1FFF]/,
  cjk: /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/,
  hiragana: /[\u3040-\u309F]/,
  katakana: /[\u30A0-\u30FF]/,
  hangul: /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/,
  thai: /[\u0E00-\u0E7F]/,
  devanagari: /[\u0900-\u097F]/,
  bengali: /[\u0980-\u09FF]/,
  emoji: /[\u1F600-\u1F64F\u1F300-\u1F5FF\u1F680-\u1F6FF\u1F700-\u1F77F]/,
};

/**
 * Enhanced grapheme segmentation using Intl.Segmenter when available
 * with fallback to existing graphemeSplit implementation
 */
export function segmentGraphemes(text: string): string[] {
  // Use native Intl.Segmenter if available
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    try {
      const segmenter = new Intl.Segmenter(undefined, {
        granularity: 'grapheme',
      });
      
      const segments = segmenter.segment(text);
      return Array.from(segments, segment => segment.segment);
    } catch (e) {
      // Fallback if Intl.Segmenter fails
    }
  }
  
  // Use existing Fabric.js implementation as fallback
  return graphemeSplit(text);
}

/**
 * Analyze text for bidirectional runs using Unicode BiDi algorithm (simplified)
 */
export function analyzeBiDi(text: string, baseDirection: 'ltr' | 'rtl' = 'ltr'): BiDiRun[] {
  if (!text) return [];

  const runs: BiDiRun[] = [];
  const chars = Array.from(text);
  let currentRun: BiDiRun | null = null;

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    const charDirection = getBidiDirection(char, baseDirection);
    
    // Start new run if direction changes
    if (!currentRun || currentRun.direction !== charDirection) {
      if (currentRun) {
        runs.push(currentRun);
      }
      
      currentRun = {
        text: char,
        direction: charDirection,
        level: charDirection === 'rtl' ? 1 : 0,
        start: i,
        end: i + 1,
      };
    } else {
      // Continue current run
      currentRun.text += char;
      currentRun.end = i + 1;
    }
  }

  // Add final run
  if (currentRun) {
    runs.push(currentRun);
  }

  return runs.length > 0 ? runs : [{
    text,
    direction: baseDirection,
    level: baseDirection === 'rtl' ? 1 : 0,
    start: 0,
    end: text.length,
  }];
}

/**
 * Detect the primary script of text for font fallback and shaping
 */
export function detectScript(text: string): string {
  const charCounts: Record<string, number> = {};
  const chars = Array.from(text);

  // Count characters by script
  for (const char of chars) {
    for (const [script, pattern] of Object.entries(SCRIPT_PATTERNS)) {
      if (pattern.test(char)) {
        charCounts[script] = (charCounts[script] || 0) + 1;
        break;
      }
    }
  }

  // Find dominant script
  let maxCount = 0;
  let dominantScript = 'latin';

  for (const [script, count] of Object.entries(charCounts)) {
    if (count > maxCount) {
      maxCount = count;
      dominantScript = script;
    }
  }

  return dominantScript;
}

/**
 * Get script information for layout decisions
 */
export function getScriptInfo(script: string): ScriptInfo {
  const scriptMap: Record<string, ScriptInfo> = {
    latin: {
      script: 'latin',
      direction: 'ltr',
      needsShaping: false,
      complexLayout: false,
    },
    arabic: {
      script: 'arabic',
      direction: 'rtl',
      needsShaping: true,
      complexLayout: true,
    },
    hebrew: {
      script: 'hebrew',
      direction: 'rtl',
      needsShaping: false,
      complexLayout: false,
    },
    thai: {
      script: 'thai',
      direction: 'ltr',
      needsShaping: true,
      complexLayout: true,
    },
    devanagari: {
      script: 'devanagari',
      direction: 'ltr',
      needsShaping: true,
      complexLayout: true,
    },
    cjk: {
      script: 'cjk',
      direction: 'ltr',
      needsShaping: false,
      complexLayout: false,
    },
  };

  return scriptMap[script] || scriptMap.latin;
}

/**
 * Break words according to language-specific rules
 */
export function breakWords(text: string, locale?: string): string[] {
  // Use native word segmentation if available
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    try {
      const segmenter = new Intl.Segmenter(locale, {
        granularity: 'word',
      });
      
      const segments = segmenter.segment(text);
      return Array.from(segments)
        .filter(segment => segment.isWordLike)
        .map(segment => segment.segment);
    } catch (e) {
      // Fallback if Intl.Segmenter fails
    }
  }

  // Simple fallback word breaking
  return text.split(/\s+/).filter(word => word.length > 0);
}

/**
 * Character classification functions
 */
export function isWhitespace(grapheme: string): boolean {
  return /\s/.test(grapheme);
}

export function isLineBreak(grapheme: string): boolean {
  return grapheme === '\n' || grapheme === '\r' || grapheme === '\r\n';
}

export function isWordSeparator(grapheme: string): boolean {
  return /[\s\-\u2010-\u2015]/.test(grapheme);
}

export function isPunctuation(grapheme: string): boolean {
  return /[\p{P}]/u.test(grapheme);
}

export function isEmoji(grapheme: string): boolean {
  return /[\p{Emoji}]/u.test(grapheme);
}

export function isRTLCharacter(char: string): boolean {
  return UNICODE_CATEGORIES.R.test(char) || UNICODE_CATEGORIES.AL.test(char);
}

/**
 * Advanced grapheme cluster handling for complex scripts
 */
export function findGraphemeClusterBoundaries(text: string): number[] {
  const boundaries: number[] = [0];
  const graphemes = segmentGraphemes(text);
  let position = 0;

  for (const grapheme of graphemes) {
    position += grapheme.length;
    boundaries.push(position);
  }

  return boundaries;
}

/**
 * Check if a position is at a grapheme cluster boundary
 */
export function isGraphemeClusterBoundary(text: string, position: number): boolean {
  const boundaries = findGraphemeClusterBoundaries(text);
  return boundaries.includes(position);
}

/**
 * Find the next grapheme cluster boundary from a given position
 */
export function findNextGraphemeClusterBoundary(text: string, position: number): number {
  const boundaries = findGraphemeClusterBoundaries(text);
  return boundaries.find(boundary => boundary > position) || text.length;
}

/**
 * Find the previous grapheme cluster boundary from a given position  
 */
export function findPreviousGraphemeClusterBoundary(text: string, position: number): number {
  const boundaries = findGraphemeClusterBoundaries(text);
  const reversedBoundaries = [...boundaries].reverse();
  return reversedBoundaries.find(boundary => boundary < position) || 0;
}

/**
 * Normalize text for consistent processing
 */
export function normalizeText(text: string, form: 'NFC' | 'NFD' | 'NFKC' | 'NFKD' = 'NFC'): string {
  if (typeof text.normalize === 'function') {
    return text.normalize(form);
  }
  return text;
}

/**
 * Detect if text contains complex script characters that need special handling
 */
export function needsComplexLayout(text: string): boolean {
  const complexScripts = ['arabic', 'hebrew', 'thai', 'devanagari', 'bengali'];
  const detectedScript = detectScript(text);
  return complexScripts.includes(detectedScript);
}

/**
 * Get text direction based on content analysis
 */
export function getTextDirection(text: string, fallback: 'ltr' | 'rtl' = 'ltr'): 'ltr' | 'rtl' {
  let rtlChars = 0;
  let ltrChars = 0;

  for (const char of text) {
    if (UNICODE_CATEGORIES.R.test(char) || UNICODE_CATEGORIES.AL.test(char)) {
      rtlChars++;
    } else if (UNICODE_CATEGORIES.L.test(char)) {
      ltrChars++;
    }
  }

  if (rtlChars > ltrChars) return 'rtl';
  if (ltrChars > rtlChars) return 'ltr';
  return fallback;
}

/**
 * Split text into lines respecting complex script rules
 */
export function splitTextLines(text: string): string[] {
  // Handle different line break types
  return text.split(/\r\n|\r|\n/);
}

/**
 * Check if combining marks or modifiers should be kept with base character
 */
export function isCombiningMark(char: string): boolean {
  return UNICODE_CATEGORIES.NSM.test(char);
}

/**
 * Get bidirectional character type
 */
function getBidiDirection(char: string, baseDirection: 'ltr' | 'rtl'): 'ltr' | 'rtl' {
  // Strong RTL characters
  if (UNICODE_CATEGORIES.R.test(char) || UNICODE_CATEGORIES.AL.test(char)) {
    return 'rtl';
  }
  
  // Strong LTR characters  
  if (UNICODE_CATEGORIES.L.test(char)) {
    return 'ltr';
  }
  
  // Numbers follow base direction in simplified algorithm
  if (UNICODE_CATEGORIES.EN.test(char) || UNICODE_CATEGORIES.AN.test(char)) {
    return baseDirection;
  }
  
  // Neutral characters follow context
  return baseDirection;
}

/**
 * Advanced word breaking for different scripts
 */
export function breakWordsAdvanced(text: string): string[] {
  const script = detectScript(text);
  
  switch (script) {
    case 'cjk':
      // CJK can break at most characters
      return Array.from(text);
    
    case 'thai':
      // Thai doesn't use spaces - would need dictionary-based breaking
      // For now, fall back to character-based breaking
      return Array.from(text);
    
    case 'arabic':
    case 'hebrew':
      // Handle RTL scripts
      return text.split(/\s+/).filter(word => word.length > 0);
    
    default:
      // Standard space-based word breaking
      return text.split(/\s+/).filter(word => word.length > 0);
  }
}

/**
 * Check if text needs right-to-left processing
 */
export function needsRTLProcessing(text: string): boolean {
  for (const char of text) {
    if (isRTLCharacter(char)) {
      return true;
    }
  }
  return false;
}

/**
 * Reverse text for RTL display (simplified - real RTL is more complex)
 */
export function reverseForRTL(text: string): string {
  // This is a simplified implementation
  // Real RTL processing requires full BiDi algorithm
  const graphemes = segmentGraphemes(text);
  return graphemes.reverse().join('');
}

/**
 * Get appropriate line breaking class for character
 */
export function getLineBreakClass(char: string): string {
  // Simplified line breaking classes
  if (/\s/.test(char)) return 'SP';
  if (/[!-\/:-@\[-`{-~]/.test(char)) return 'BA'; // Break after
  if (/[(\[{]/.test(char)) return 'OP'; // Open punctuation
  if (/[)\]}]/.test(char)) return 'CL'; // Close punctuation
  if (/\d/.test(char)) return 'NU'; // Numeric
  if (/[A-Za-z]/.test(char)) return 'AL'; // Alphabetic
  
  return 'AL'; // Default to alphabetic
}

/**
 * Check if line break is allowed between two characters
 */
export function isLineBreakAllowed(before: string, after: string): boolean {
  const beforeClass = getLineBreakClass(before);
  const afterClass = getLineBreakClass(after);
  
  // Simplified line breaking rules
  if (beforeClass === 'OP') return false; // Don't break after opening
  if (afterClass === 'CL') return false; // Don't break before closing
  if (beforeClass === 'SP') return true; // Always allow break after space
  
  return true; // Default allow
}