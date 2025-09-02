/**
 * Unit tests for text layout engine
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { layoutText } from '../../../src/text/layout';
import type { TextLayoutOptions } from '../../../src/text/layout';
import * as measureModule from '../../../src/text/measure';
import * as ellipsisModule from '../../../src/text/ellipsis';
import * as unicodeModule from '../../../src/text/unicode';

// Mock dependencies
vi.mock('../../../src/text/measure');
vi.mock('../../../src/text/ellipsis');
vi.mock('../../../src/text/unicode');

const mockMeasureGraphemeWithKerning = vi.mocked(measureModule.measureGraphemeWithKerning);
const mockApplyEllipsis = vi.mocked(ellipsisModule.applyEllipsis);
const mockSegmentGraphemes = vi.mocked(unicodeModule.segmentGraphemes);

const createDefaultOptions = (overrides?: Partial<TextLayoutOptions>): TextLayoutOptions => ({
  text: 'Hello World',
  wrap: 'word',
  align: 'left',
  fontSize: 16,
  lineHeight: 1.2,
  fontFamily: 'Arial',
  fontStyle: 'normal',
  fontWeight: 'normal',
  direction: 'ltr',
  ...overrides,
});

describe('layoutText', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Default mocks
    mockSegmentGraphemes.mockImplementation((text: string) => text.split(''));
    mockMeasureGraphemeWithKerning.mockReturnValue({
      width: 8,
      height: 16,
      ascent: 12,
      descent: 4,
      baseline: 12,
      kernedWidth: 8,
    });
  });

  describe('basic layout', () => {
    it('should handle empty text', () => {
      const result = layoutText(createDefaultOptions({ text: '' }));
      
      expect(result.lines).toHaveLength(0);
      expect(result.totalWidth).toBe(0);
      expect(result.totalHeight).toBe(0);
      expect(result.isTruncated).toBe(false);
      expect(result.graphemeCount).toBe(0);
    });

    it('should layout single line text', () => {
      mockSegmentGraphemes.mockReturnValue(['H', 'e', 'l', 'l', 'o']);
      
      const result = layoutText(createDefaultOptions({ 
        text: 'Hello',
        width: undefined // auto width
      }));

      expect(result.lines).toHaveLength(1);
      expect(result.lines[0].text).toBe('Hello');
      expect(result.lines[0].graphemes).toEqual(['H', 'e', 'l', 'l', 'o']);
      expect(result.lines[0].width).toBe(40); // 5 chars * 8px each
      expect(result.totalWidth).toBe(40);
      expect(result.isTruncated).toBe(false);
    });

    it('should handle multi-line text with newlines', () => {
      mockSegmentGraphemes
        .mockReturnValueOnce(['L', 'i', 'n', 'e', '1'])
        .mockReturnValueOnce(['L', 'i', 'n', 'e', '2']);

      const result = layoutText(createDefaultOptions({ 
        text: 'Line1\nLine2'
      }));

      expect(result.lines).toHaveLength(2);
      expect(result.lines[0].text).toBe('Line1');
      expect(result.lines[1].text).toBe('Line2');
      expect(result.totalHeight).toBe(38.4); // 2 lines * 16px * 1.2 line height
    });
  });

  describe('text wrapping', () => {
    beforeEach(() => {
      mockSegmentGraphemes.mockReturnValue(['T', 'h', 'i', 's', ' ', 'i', 's', ' ', 'l', 'o', 'n', 'g']);
    });

    it('should wrap by words when wrap is "word"', () => {
      const result = layoutText(createDefaultOptions({
        text: 'This is long',
        width: 50, // Should force wrapping
        wrap: 'word'
      }));

      expect(result.lines.length).toBeGreaterThan(1);
      // Should break at word boundaries, not in middle of words
      expect(result.lines.some(line => line.text.includes('Th'))).toBe(false);
    });

    it('should wrap by characters when wrap is "char"', () => {
      const result = layoutText(createDefaultOptions({
        text: 'This is long',
        width: 50,
        wrap: 'char'
      }));

      expect(result.lines.length).toBeGreaterThan(1);
      // Character wrapping allows breaking anywhere
      result.lines.forEach(line => {
        expect(line.width).toBeLessThanOrEqual(50);
      });
    });

    it('should not wrap when wrap is "none"', () => {
      const result = layoutText(createDefaultOptions({
        text: 'This is a very long line that should not wrap',
        width: 50,
        wrap: 'none'
      }));

      expect(result.lines).toHaveLength(1);
      expect(result.lines[0].width).toBeGreaterThan(50);
    });
  });

  describe('text alignment', () => {
    beforeEach(() => {
      mockSegmentGraphemes.mockReturnValue(['H', 'e', 'l', 'l', 'o']);
    });

    it('should left align text by default', () => {
      const result = layoutText(createDefaultOptions({
        text: 'Hello',
        width: 100,
        align: 'left'
      }));

      expect(result.lines[0].bounds[0].x).toBe(0);
    });

    it('should center align text', () => {
      const result = layoutText(createDefaultOptions({
        text: 'Hello',
        width: 100,
        align: 'center'
      }));

      // Text width is 40px, container is 100px, so offset should be 30px
      expect(result.lines[0].bounds[0].x).toBe(30);
    });

    it('should right align text', () => {
      const result = layoutText(createDefaultOptions({
        text: 'Hello',
        width: 100,
        align: 'right'
      }));

      // Text width is 40px, container is 100px, so offset should be 60px
      expect(result.lines[0].bounds[0].x).toBe(60);
    });

    it('should justify text with space expansion', () => {
      mockSegmentGraphemes.mockReturnValue(['H', 'e', 'l', 'l', 'o', ' ', 'W', 'o', 'r', 'l', 'd']);
      
      const result = layoutText(createDefaultOptions({
        text: 'Hello World',
        width: 100,
        align: 'justify'
      }));

      const line = result.lines[0];
      expect(line.width).toBe(100); // Should expand to fill width
      expect(line.justifyRatio).toBeGreaterThan(1); // Spaces should be expanded
    });
  });

  describe('ellipsis handling', () => {
    beforeEach(() => {
      mockSegmentGraphemes.mockReturnValue(['V', 'e', 'r', 'y', ' ', 'l', 'o', 'n', 'g', ' ', 't', 'e', 'x', 't']);
      mockApplyEllipsis.mockReturnValue({
        truncatedText: 'Very lo…',
        isTruncated: true,
        truncationIndex: 7,
        ellipsisWidth: 8,
        originalLength: 14,
      });
    });

    it('should apply ellipsis when text exceeds width', () => {
      const result = layoutText(createDefaultOptions({
        text: 'Very long text',
        width: 60,
        ellipsis: true,
        wrap: 'none'
      }));

      expect(mockApplyEllipsis).toHaveBeenCalled();
      expect(result.isTruncated).toBe(true);
    });

    it('should use custom ellipsis string', () => {
      layoutText(createDefaultOptions({
        text: 'Very long text',
        width: 60,
        ellipsis: '...',
        wrap: 'none'
      }));

      expect(mockApplyEllipsis).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          ellipsisChar: '...'
        })
      );
    });

    it('should not apply ellipsis when text fits', () => {
      const result = layoutText(createDefaultOptions({
        text: 'Short',
        width: 200,
        ellipsis: true,
        wrap: 'none'
      }));

      expect(result.isTruncated).toBe(false);
    });
  });

  describe('letter spacing', () => {
    beforeEach(() => {
      mockSegmentGraphemes.mockReturnValue(['A', 'B', 'C']);
    });

    it('should apply letter spacing to all characters', () => {
      const result = layoutText(createDefaultOptions({
        text: 'ABC',
        letterSpacing: 2
      }));

      const line = result.lines[0];
      // 3 chars * 8px + 3 chars * 2px letter spacing = 30px
      expect(line.width).toBe(30);
    });

    it('should apply both letter spacing and char spacing', () => {
      const result = layoutText(createDefaultOptions({
        text: 'ABC',
        letterSpacing: 2,
        charSpacing: 100, // 100/1000 * 16px = 1.6px
        fontSize: 16
      }));

      const line = result.lines[0];
      // 3 chars * 8px + 3 * (2px + 1.6px) = 24 + 10.8 = 34.8px
      expect(line.width).toBe(34.8);
    });
  });

  describe('vertical alignment', () => {
    beforeEach(() => {
      mockSegmentGraphemes.mockReturnValue(['T', 'e', 's', 't']);
    });

    it('should apply top vertical alignment by default', () => {
      const result = layoutText(createDefaultOptions({
        text: 'Test',
        height: 100,
        verticalAlign: 'top'
      }));

      expect(result.lines[0].bounds[0].y).toBe(0);
    });

    it('should apply middle vertical alignment', () => {
      const result = layoutText(createDefaultOptions({
        text: 'Test',
        height: 100,
        verticalAlign: 'middle'
      }));

      // Text height is 19.2px (16 * 1.2), container is 100px
      // Middle offset should be (100 - 19.2) / 2 = 40.4px
      expect(result.lines[0].bounds[0].y).toBe(40.4);
    });

    it('should apply bottom vertical alignment', () => {
      const result = layoutText(createDefaultOptions({
        text: 'Test',
        height: 100,
        verticalAlign: 'bottom'
      }));

      // Bottom offset should be 100 - 19.2 = 80.8px
      expect(result.lines[0].bounds[0].y).toBe(80.8);
    });
  });

  describe('RTL text direction', () => {
    beforeEach(() => {
      mockSegmentGraphemes.mockReturnValue(['م', 'ر', 'ح', 'ب', 'ا']);
    });

    it('should handle RTL text direction', () => {
      const result = layoutText(createDefaultOptions({
        text: 'مرحبا',
        direction: 'rtl',
        width: 100
      }));

      expect(result.lines).toHaveLength(1);
      expect(result.lines[0].graphemes).toEqual(['م', 'ر', 'ح', 'ب', 'ا']);
    });

    it('should inherit direction when set to inherit', () => {
      const result = layoutText(createDefaultOptions({
        text: 'Test',
        direction: 'inherit'
      }));

      // Should default to LTR when inherit
      expect(result.lines[0].bounds[0].x).toBe(0);
    });
  });

  describe('line height', () => {
    beforeEach(() => {
      mockSegmentGraphemes.mockReturnValue(['L', 'i', 'n', 'e', '1']);
    });

    it('should apply line height multiplier', () => {
      const result = layoutText(createDefaultOptions({
        text: 'Line1\nLine2',
        lineHeight: 1.5
      }));

      expect(result.lines[0].height).toBe(24); // 16px * 1.5
      expect(result.totalHeight).toBe(48); // 2 lines * 24px
    });

    it('should handle line height of 1.0', () => {
      const result = layoutText(createDefaultOptions({
        text: 'Line1\nLine2',
        lineHeight: 1.0
      }));

      expect(result.lines[0].height).toBe(16); // 16px * 1.0
    });
  });

  describe('edge cases', () => {
    it('should handle single character', () => {
      mockSegmentGraphemes.mockReturnValue(['A']);
      
      const result = layoutText(createDefaultOptions({
        text: 'A'
      }));

      expect(result.lines).toHaveLength(1);
      expect(result.lines[0].graphemes).toEqual(['A']);
      expect(result.totalWidth).toBe(8);
    });

    it('should handle only whitespace', () => {
      mockSegmentGraphemes.mockReturnValue([' ', ' ', ' ']);
      
      const result = layoutText(createDefaultOptions({
        text: '   '
      }));

      expect(result.lines).toHaveLength(1);
      expect(result.totalWidth).toBe(24); // 3 spaces * 8px each
    });

    it('should handle zero width container', () => {
      const result = layoutText(createDefaultOptions({
        text: 'Test',
        width: 0,
        wrap: 'char'
      }));

      // Should still create layout, just very narrow
      expect(result.lines.length).toBeGreaterThan(0);
    });

    it('should handle very long words with word wrap', () => {
      mockSegmentGraphemes.mockReturnValue('Supercalifragilisticexpialidocious'.split(''));
      
      const result = layoutText(createDefaultOptions({
        text: 'Supercalifragilisticexpialidocious',
        width: 50,
        wrap: 'word'
      }));

      // Should break the long word when no spaces available
      expect(result.lines.length).toBeGreaterThan(1);
    });

    it('should handle mixed newlines and wrapping', () => {
      const result = layoutText(createDefaultOptions({
        text: 'Short line\nThis is a much longer line that should wrap',
        width: 80,
        wrap: 'word'
      }));

      expect(result.lines.length).toBeGreaterThan(2);
      // First line should be intact
      expect(result.lines[0].text).toBe('Short line');
    });
  });

  describe('performance considerations', () => {
    it('should handle large text efficiently', () => {
      const longText = 'A'.repeat(1000);
      mockSegmentGraphemes.mockReturnValue(longText.split(''));
      
      const start = performance.now();
      const result = layoutText(createDefaultOptions({
        text: longText,
        width: 400,
        wrap: 'char'
      }));
      const duration = performance.now() - start;

      expect(result.lines.length).toBeGreaterThan(1);
      expect(duration).toBeLessThan(100); // Should complete in reasonable time
    });
  });

  describe('bounds calculation', () => {
    beforeEach(() => {
      mockSegmentGraphemes.mockReturnValue(['A', 'B', 'C']);
    });

    it('should calculate correct character bounds', () => {
      const result = layoutText(createDefaultOptions({
        text: 'ABC'
      }));

      const bounds = result.lines[0].bounds;
      expect(bounds).toHaveLength(3);
      
      // First character at position 0
      expect(bounds[0].x).toBe(0);
      expect(bounds[0].left).toBe(0);
      expect(bounds[0].width).toBe(8);
      
      // Second character at position 8
      expect(bounds[1].x).toBe(8);
      expect(bounds[1].left).toBe(8);
      
      // Third character at position 16
      expect(bounds[2].x).toBe(16);
      expect(bounds[2].left).toBe(16);
    });

    it('should include kerning in bounds calculation', () => {
      mockMeasureGraphemeWithKerning
        .mockReturnValueOnce({
          width: 8, height: 16, ascent: 12, descent: 4, baseline: 12, kernedWidth: 8
        })
        .mockReturnValueOnce({
          width: 8, height: 16, ascent: 12, descent: 4, baseline: 12, kernedWidth: 6 // Kerned closer
        });

      const result = layoutText(createDefaultOptions({
        text: 'AB'
      }));

      const bounds = result.lines[0].bounds;
      expect(bounds[0].kernedWidth).toBe(8);
      expect(bounds[1].kernedWidth).toBe(6); // Kerned width used
    });
  });
});