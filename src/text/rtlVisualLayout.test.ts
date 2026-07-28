import { describe, expect, it } from 'vitest';
import {
  createVisualLineLayout,
  getVisualLineOffset,
  hitTestVisualCaret,
  mergeVisualIntervals,
  normalizeVisualAdvances,
  subdivideVisualClusterRun,
} from './rtlVisualLayout';

describe('RTL visual editing layout', () => {
  it('places a pure Arabic line in right-to-left visual order', () => {
    const layout = createVisualLineLayout(
      Array.from('مرحبا'),
      [10, 11, 12, 13, 14],
      'rtl',
    );

    expect(layout.visualOrder).toEqual([4, 3, 2, 1, 0]);
    expect(layout.clusters.map(({ displayIndex }) => displayIndex)).toEqual([
      4, 3, 2, 1, 0,
    ]);
  });

  it('keeps European digits left-to-right inside an Arabic paragraph', () => {
    const layout = createVisualLineLayout(
      Array.from('س12م'),
      [10, 10, 10, 10],
      'rtl',
    );

    expect(layout.visualOrder).toEqual([3, 1, 2, 0]);
  });

  it('reorders mixed RTL paragraphs while preserving English run order', () => {
    const line = Array.from('Hello مرحبا World عالم');
    const layout = createVisualLineLayout(
      line,
      line.map(() => 10),
      'rtl',
    );

    expect(layout.visualOrder).toEqual([
      21, 20, 19, 18, 17, 12, 13, 14, 15, 16, 11, 10, 9, 8, 7, 6, 5, 0, 1, 2, 3,
      4,
    ]);
  });

  it('keeps Arabic letters with tashkeel RTL in an LTR paragraph', () => {
    const layout = createVisualLineLayout(['مَ', 'رْ'], [12, 12], 'ltr');

    expect(layout.visualOrder).toEqual([1, 0]);
    expect(layout.clusters.every(({ isRtl }) => isRtl)).toBe(true);
  });

  it('repairs negative Arabic shaping advances without changing line width', () => {
    const advances = normalizeVisualAdvances(
      [
        { width: 17.12, kernedWidth: 17.12 },
        { width: 13.51, kernedWidth: 1.36 },
        { width: 6.77, kernedWidth: -2.26 },
        { width: 8.11, kernedWidth: 0.57 },
      ],
      40,
    );

    expect(advances.every((advance) => advance > 0)).toBe(true);
    expect(advances.reduce((sum, advance) => sum + advance, 0)).toBeCloseTo(
      40,
      10,
    );
  });

  it('uses the clicked half of an RTL glyph to resolve the logical caret', () => {
    const layout = createVisualLineLayout(['ا', 'ب'], [20, 20], 'rtl');

    expect(hitTestVisualCaret(layout, 5).displayIndex).toBe(2);
    expect(hitTestVisualCaret(layout, 15).displayIndex).toBe(1);
    expect(hitTestVisualCaret(layout, 25).displayIndex).toBe(1);
    expect(hitTestVisualCaret(layout, 35).displayIndex).toBe(0);
  });

  it('converts Fabric line anchors for every base direction', () => {
    expect(getVisualLineOffset(200, 80, 0, 'ltr')).toBe(0);
    expect(getVisualLineOffset(200, 80, 120, 'ltr')).toBe(120);
    expect(getVisualLineOffset(200, 80, 0, 'rtl')).toBe(120);
    expect(getVisualLineOffset(200, 80, -120, 'rtl')).toBe(0);
  });

  it('preserves discontiguous BiDi selection intervals', () => {
    expect(
      mergeVisualIntervals([
        { x: 0, width: 10 },
        { x: 10, width: 10 },
        { x: 40, width: 10 },
      ]),
    ).toEqual([
      { x: 0, width: 20 },
      { x: 40, width: 10 },
    ]);
  });

  it('gives every repeated RTL tatweel an independent visual caret cell', () => {
    const layout = createVisualLineLayout(
      ['ت', 'ج', 'ـ', 'ـ', 'ـ', 'ـ', 'ر'],
      [10, 10, 10, 10, 10, 10, 10],
      'rtl',
    );
    const clusters = subdivideVisualClusterRun(layout.clusters, 2, 6, 20, 40);
    const tatweels = clusters
      .filter(({ displayIndex }) => displayIndex >= 2 && displayIndex < 6)
      .sort((a, b) => a.displayIndex - b.displayIndex);

    expect(tatweels.map(({ visualX }) => visualX)).toEqual([50, 40, 30, 20]);
    expect(tatweels.map(({ width }) => width)).toEqual([10, 10, 10, 10]);
  });
});
