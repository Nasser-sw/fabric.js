import { describe, expect, it } from 'vitest';
import { getContainedRangeRects } from './installNativeRtlEditing';

const rect = (left: number, top: number, width: number, height: number) =>
  ({
    left,
    right: left + width,
    top,
    bottom: top + height,
    width,
    height,
  }) as DOMRect;

describe('native RTL DOM range geometry', () => {
  const container = rect(-100_000, 0, 350, 30);

  it('ignores WebKit range artifacts outside the measuring span', () => {
    const artifact = rect(0, 0, 0, 0);
    const glyph = rect(-99_940, 2, 18, 24);

    expect(getContainedRangeRects(container, [artifact, glyph], false)).toEqual(
      [glyph],
    );
  });

  it('accepts a zero-width caret with a real line height', () => {
    const caret = rect(-99_825, 2, 0, 24);

    expect(getContainedRangeRects(container, [caret], true)).toEqual([caret]);
    expect(getContainedRangeRects(container, [caret], false)).toEqual([]);
  });

  it('rejects a collapsed zero-sized rectangle at the page origin', () => {
    expect(getContainedRangeRects(container, [rect(0, 0, 0, 0)], true)).toEqual(
      [],
    );
  });

  it('allows small native glyph overhangs around the measuring span', () => {
    const overhangingGlyph = rect(-100_001, 1, 352, 28);

    expect(
      getContainedRangeRects(container, [overhangingGlyph], false),
    ).toEqual([overhangingGlyph]);
  });
});
