import { describe, expect, it } from 'vitest';
import {
  findProfessionalKashidaPoints,
  planKashida,
  type KashidaLevel,
} from './kashida';
import { ARABIC_TATWEEL, canInsertKashida, isArabicLetter } from './unicode';

describe('professional Arabic kashida planning', () => {
  it('only accepts joins that preserve Arabic shaping', () => {
    expect(canInsertKashida('ب', 'ت')).toBe(true);
    expect(canInsertKashida('ا', 'ب')).toBe(false);
    expect(canInsertKashida('ل', 'ا')).toBe(false);
    expect(canInsertKashida('ب', 'ء')).toBe(false);
    expect(canInsertKashida('ب', ARABIC_TATWEEL)).toBe(false);
    expect(canInsertKashida(ARABIC_TATWEEL, 'ت')).toBe(false);
    expect(isArabicLetter(ARABIC_TATWEEL)).toBe(false);
  });

  it('prefers a seen-class join and records exact Arabic word boundaries', () => {
    const points = findProfessionalKashidaPoints(Array.from('سعيد، بعيد'));

    expect(points[0]).toMatchObject({
      charIndex: 0,
      wordStart: 0,
      wordEnd: 4,
    });
    expect(
      points.some(
        ({ wordStart, wordEnd }) => wordStart === 6 && wordEnd === 10,
      ),
    ).toBe(true);
  });

  it('uses one preferred location per word and scales presets predictably', () => {
    const line = Array.from('سعيد بعيد كبير');
    const totals = (
      ['short', 'medium', 'long', 'stylistic'] as KashidaLevel[]
    ).map((level) => planKashida(line, 40, 5, level));

    expect(totals.map(({ totalTatweels }) => totalTatweels)).toEqual([
      2, 3, 6, 8,
    ]);
    for (const plan of totals) {
      expect(new Set(plan.points.map(({ wordStart }) => wordStart)).size).toBe(
        plan.points.length,
      );
    }
    expect(
      Math.max(...totals[0].points.map(({ tatweelCount }) => tatweelCount)),
    ).toBe(1);
    expect(
      Math.max(...totals[2].points.map(({ tatweelCount }) => tatweelCount)),
    ).toBe(2);
    expect(
      Math.max(...totals[3].points.map(({ tatweelCount }) => tatweelCount)),
    ).toBe(3);
  });

  it('leaves sub-glyph expansion to normal word spacing', () => {
    expect(planKashida(Array.from('سعيد'), 3, 5, 'short').points).toEqual([]);
  });
});
