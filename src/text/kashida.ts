import { ARABIC_TATWEEL, canInsertKashida, isArabicLetter } from './unicode';

export type KashidaLevel = 'none' | 'short' | 'medium' | 'long' | 'stylistic';

export interface KashidaCandidate {
  charIndex: number;
  priority: number;
  wordStart: number;
  wordEnd: number;
}

export interface PlannedKashidaPoint extends KashidaCandidate {
  tatweelCount: number;
  width: number;
}

export interface KashidaPlan {
  points: PlannedKashidaPoint[];
  targetWidth: number;
  estimatedWidth: number;
  totalTatweels: number;
}

const ALEF_CLASS = new Set(['\u0622', '\u0623', '\u0625', '\u0627', '\u0671']);
const BEH_CLASS = new Set([
  '\u0626',
  '\u0628',
  '\u062a',
  '\u062b',
  '\u0646',
  '\u0649',
  '\u064a',
  '\u0678',
  '\u0679',
  '\u067a',
  '\u067b',
  '\u067e',
  '\u06a6',
  '\u06cc',
  '\u06d0',
]);
const HEH_CLASS = new Set(['\u0629', '\u0647']);
const REH_CLASS = new Set(['\u0631', '\u0632', '\u0691', '\u0698']);
const SEEN_CLASS = new Set(['\u0633', '\u0634', '\u0635', '\u0636']);

const baseCharacter = (grapheme: string): string =>
  Array.from(grapheme || '')[0] || '';

const isTatweel = (grapheme: string): boolean =>
  baseCharacter(grapheme) === ARABIC_TATWEEL;

const isArabicWordGrapheme = (grapheme: string): boolean =>
  isArabicLetter(grapheme) || isTatweel(grapheme);

/**
 * Finds typographically eligible Arabic joins and orders them by the broad
 * priority hierarchy exposed by professional shaping systems:
 * seen-class initial/medial forms, selected final forms, then normal medial
 * joins. Position in the middle of a word is used as a tie-breaker.
 */
export const findProfessionalKashidaPoints = (
  graphemes: string[],
): KashidaCandidate[] => {
  const points: KashidaCandidate[] = [];

  const addCandidate = (
    previousIndex: number,
    nextIndex: number,
    insertionIndex: number,
    authoredTatweel = false,
  ) => {
    const previous = graphemes[previousIndex];
    const next = graphemes[nextIndex];
    let wordStart = previousIndex;
    while (wordStart > 0 && isArabicWordGrapheme(graphemes[wordStart - 1])) {
      wordStart--;
    }
    let wordEnd = nextIndex + 1;
    while (
      wordEnd < graphemes.length &&
      isArabicWordGrapheme(graphemes[wordEnd])
    ) {
      wordEnd++;
    }

    const previousBase = baseCharacter(previous);
    const nextBase = baseCharacter(next);
    const nextIsFinal = nextIndex === wordEnd - 1;
    const wordLength = graphemes
      .slice(wordStart, wordEnd)
      .filter(isArabicLetter).length;
    const positionInWord = graphemes
      .slice(wordStart, previousIndex + 1)
      .filter(isArabicLetter).length;
    const distanceFromEdge = Math.min(
      positionInWord,
      wordLength - positionInWord - 1,
    );

    let priority = 10;
    if (SEEN_CLASS.has(previousBase)) {
      priority += 100;
    }
    if (nextIsFinal) {
      if (BEH_CLASS.has(nextBase)) {
        priority += 80;
      } else if (REH_CLASS.has(nextBase)) {
        priority += 70;
      } else if (HEH_CLASS.has(nextBase)) {
        priority += 60;
      } else if (ALEF_CLASS.has(nextBase)) {
        priority += 50;
      }
    }
    if (authoredTatweel) {
      // Preserve the typographer's chosen elongation location.
      priority += 200;
    }
    priority += distanceFromEdge * 4 + Math.min(wordLength, 8);

    points.push({
      charIndex: insertionIndex,
      priority,
      wordStart,
      wordEnd,
    });
  };

  for (let charIndex = 0; charIndex < graphemes.length - 1; charIndex++) {
    if (isTatweel(graphemes[charIndex])) {
      const runStart = charIndex;
      let runEnd = runStart + 1;
      while (runEnd < graphemes.length && isTatweel(graphemes[runEnd])) {
        runEnd++;
      }
      if (
        runStart > 0 &&
        runEnd < graphemes.length &&
        canInsertKashida(graphemes[runStart - 1], graphemes[runEnd])
      ) {
        addCandidate(runStart - 1, runEnd, runEnd - 1, true);
      }
      charIndex = runEnd - 1;
      continue;
    }

    if (canInsertKashida(graphemes[charIndex], graphemes[charIndex + 1])) {
      addCandidate(charIndex, charIndex + 1, charIndex);
    }
  }

  return points.sort(
    (a, b) => b.priority - a.priority || a.wordStart - b.wordStart,
  );
};

const LEVEL_CONFIG: Record<
  KashidaLevel,
  { ratio: number; maxTatweelsPerWord: number }
> = {
  none: { ratio: 0, maxTatweelsPerWord: 0 },
  short: { ratio: 0.25, maxTatweelsPerWord: 1 },
  medium: { ratio: 0.5, maxTatweelsPerWord: 1 },
  long: { ratio: 0.75, maxTatweelsPerWord: 2 },
  stylistic: {
    ratio: 1,
    maxTatweelsPerWord: Number.POSITIVE_INFINITY,
  },
};

/**
 * Builds one balanced kashida plan for a justified line.
 *
 * A line uses only the best join in each word. Longer presets extend that
 * preferred join in balanced passes instead of producing multiple kashida
 * locations in the same word. The caller fills any residual width using
 * inter-word spacing after measuring the actual shaped result.
 */
export const planKashida = (
  graphemes: string[],
  extraWidth: number,
  tatweelWidth: number,
  level: KashidaLevel,
): KashidaPlan => {
  const config = LEVEL_CONFIG[level] || LEVEL_CONFIG.none;
  const targetWidth = Math.max(0, extraWidth) * config.ratio;
  if (targetWidth <= 0 || !Number.isFinite(tatweelWidth) || tatweelWidth <= 0) {
    return { points: [], targetWidth, estimatedWidth: 0, totalTatweels: 0 };
  }

  const bestByWord = new Map<number, KashidaCandidate>();
  for (const point of findProfessionalKashidaPoints(graphemes)) {
    if (!bestByWord.has(point.wordStart)) {
      bestByWord.set(point.wordStart, point);
    }
  }
  const preferredPoints = [...bestByWord.values()].sort(
    (a, b) => b.priority - a.priority || a.wordStart - b.wordStart,
  );
  if (preferredPoints.length === 0) {
    return { points: [], targetWidth, estimatedWidth: 0, totalTatweels: 0 };
  }

  const capacity = preferredPoints.length * config.maxTatweelsPerWord;
  const requestedTatweels = Math.floor(targetWidth / tatweelWidth);
  const totalTatweels = Math.min(requestedTatweels, capacity);
  if (totalTatweels === 0) {
    return { points: [], targetWidth, estimatedWidth: 0, totalTatweels: 0 };
  }

  const counts = new Map<number, number>();
  let allocated = 0;
  for (
    let pass = 0;
    pass < config.maxTatweelsPerWord && allocated < totalTatweels;
    pass++
  ) {
    for (const point of preferredPoints) {
      if (allocated >= totalTatweels) {
        break;
      }
      counts.set(point.wordStart, (counts.get(point.wordStart) || 0) + 1);
      allocated++;
    }
  }

  const points = preferredPoints
    .filter((point) => counts.has(point.wordStart))
    .map((point) => {
      const tatweelCount = counts.get(point.wordStart) || 0;
      return {
        ...point,
        tatweelCount,
        width: tatweelCount * tatweelWidth,
      };
    });

  return {
    points,
    targetWidth,
    estimatedWidth: allocated * tatweelWidth,
    totalTatweels: allocated,
  };
};
