export type BaseDirection = 'ltr' | 'rtl';

type BidiType =
  | 'L'
  | 'R'
  | 'AL'
  | 'EN'
  | 'AN'
  | 'ES'
  | 'ET'
  | 'CS'
  | 'NSM'
  | 'WS'
  | 'B'
  | 'S'
  | 'ON';

export interface VisualCluster {
  displayIndex: number;
  visualX: number;
  width: number;
  level: number;
  isRtl: boolean;
}

export interface VisualCaret {
  displayIndex: number;
  visualX: number;
  affinity: 'before' | 'after';
  clusterDisplayIndex: number;
}

export interface VisualLineLayout {
  clusters: VisualCluster[];
  carets: VisualCaret[];
  visualOrder: number[];
  levels: number[];
  width: number;
}

export interface GraphemeAdvance {
  width?: number;
  kernedWidth?: number;
}

const ARABIC_LETTER = /\p{Script=Arabic}/u;
const HEBREW_LETTER = /\p{Script=Hebrew}/u;
const LETTER = /\p{Letter}/u;
const MARK = /\p{Mark}/u;
const NUMBER = /\p{Number}/u;
const WHITESPACE = /\s/u;

const classify = (grapheme: string): BidiType => {
  if (grapheme === '\n' || grapheme === '\r' || grapheme === '\r\n') {
    return 'B';
  }
  if (grapheme === '\t') {
    return 'S';
  }
  if (WHITESPACE.test(grapheme)) {
    return 'WS';
  }
  if (/^[\u0660-\u0669]+$/u.test(grapheme)) {
    return 'AN';
  }
  if (NUMBER.test(grapheme)) {
    return 'EN';
  }
  // U+0640 ARABIC TATWEEL has the Unicode Script=Common property even though
  // its BiDi class is AL. Handle it before the generic Letter rule.
  if (/^\u0640+$/u.test(grapheme)) {
    return 'AL';
  }
  if (ARABIC_LETTER.test(grapheme)) {
    return 'AL';
  }
  if (HEBREW_LETTER.test(grapheme)) {
    return 'R';
  }
  if (LETTER.test(grapheme)) {
    return 'L';
  }
  // Fabric segments a base letter and its combining marks as one grapheme.
  // Test scripts/letters before marks so Arabic tashkeel inherits its base
  // letter's direction rather than the preceding paragraph character.
  if (MARK.test(grapheme)) {
    return 'NSM';
  }
  if (/^[+\-\u2212]$/u.test(grapheme)) {
    return 'ES';
  }
  if (/^[,.:/\u060C\u066B\u066C]$/u.test(grapheme)) {
    return 'CS';
  }
  if (/^[#$%\u00A2-\u00A5\u0609\u060A\u066A]$/u.test(grapheme)) {
    return 'ET';
  }
  return 'ON';
};

const strongForNeutral = (type: BidiType): 'L' | 'R' | null => {
  if (type === 'L') {
    return 'L';
  }
  if (type === 'R' || type === 'EN' || type === 'AN') {
    return 'R';
  }
  return null;
};

/**
 * Resolves the UAX #9 rules needed by Fabric's inline editing geometry.
 * Explicit embedding controls are intentionally treated as neutral because
 * Fabric does not currently expose paragraph-level embedding controls.
 */
export const resolveBidiLevels = (
  graphemes: string[],
  baseDirection: BaseDirection,
): number[] => {
  const baseType: 'L' | 'R' = baseDirection === 'rtl' ? 'R' : 'L';
  const baseLevel = baseDirection === 'rtl' ? 1 : 0;
  const original = graphemes.map(classify);
  const types = [...original];

  // W1: non-spacing marks inherit the previous character type.
  let previousType: BidiType = baseType;
  for (let index = 0; index < types.length; index++) {
    if (types[index] === 'NSM') {
      types[index] = previousType;
    } else {
      previousType = types[index];
    }
  }

  // W2: European numbers following an Arabic letter become Arabic numbers.
  let previousStrong: BidiType = baseType;
  for (let index = 0; index < types.length; index++) {
    const type = types[index];
    if (type === 'R' || type === 'L' || type === 'AL') {
      previousStrong = type;
    } else if (type === 'EN' && previousStrong === 'AL') {
      types[index] = 'AN';
    }
  }

  // W3: Arabic letters resolve as strong RTL.
  for (let index = 0; index < types.length; index++) {
    if (types[index] === 'AL') {
      types[index] = 'R';
    }
  }

  // W4: separators between like numbers adopt the number type.
  for (let index = 1; index < types.length - 1; index++) {
    const before = types[index - 1];
    const after = types[index + 1];
    if (types[index] === 'ES' && before === 'EN' && after === 'EN') {
      types[index] = 'EN';
    } else if (
      types[index] === 'CS' &&
      before === after &&
      (before === 'EN' || before === 'AN')
    ) {
      types[index] = before;
    }
  }

  // W5: a run of terminators touching an EN run adopts EN.
  for (let index = 0; index < types.length; ) {
    if (types[index] !== 'ET') {
      index++;
      continue;
    }
    const start = index;
    while (index < types.length && types[index] === 'ET') {
      index++;
    }
    const before = start > 0 ? types[start - 1] : null;
    const after = index < types.length ? types[index] : null;
    if (before === 'EN' || after === 'EN') {
      for (let cursor = start; cursor < index; cursor++) {
        types[cursor] = 'EN';
      }
    }
  }

  // W6: remaining separators and terminators become neutral.
  for (let index = 0; index < types.length; index++) {
    if (
      types[index] === 'ES' ||
      types[index] === 'ET' ||
      types[index] === 'CS'
    ) {
      types[index] = 'ON';
    }
  }

  // W7: EN following strong L behaves as L.
  previousStrong = baseType;
  for (let index = 0; index < types.length; index++) {
    const type = types[index];
    if (type === 'L' || type === 'R') {
      previousStrong = type;
    } else if (type === 'EN' && previousStrong === 'L') {
      types[index] = 'L';
    }
  }

  // N1/N2: resolve contiguous neutral sequences from surrounding context.
  for (let index = 0; index < types.length; ) {
    const type = types[index];
    if (type !== 'WS' && type !== 'ON' && type !== 'B' && type !== 'S') {
      index++;
      continue;
    }

    const start = index;
    while (
      index < types.length &&
      (types[index] === 'WS' ||
        types[index] === 'ON' ||
        types[index] === 'B' ||
        types[index] === 'S')
    ) {
      index++;
    }

    let before: 'L' | 'R' = baseType;
    for (let cursor = start - 1; cursor >= 0; cursor--) {
      const strong = strongForNeutral(types[cursor]);
      if (strong) {
        before = strong;
        break;
      }
    }

    let after: 'L' | 'R' = baseType;
    for (let cursor = index; cursor < types.length; cursor++) {
      const strong = strongForNeutral(types[cursor]);
      if (strong) {
        after = strong;
        break;
      }
    }

    const resolved: BidiType = before === after ? before : baseType;
    for (let cursor = start; cursor < index; cursor++) {
      types[cursor] = resolved;
    }
  }

  // I1/I2: implicit embedding levels.
  return types.map((type) => {
    if ((baseLevel & 1) === 0) {
      if (type === 'R') {
        return baseLevel + 1;
      }
      if (type === 'AN' || type === 'EN') {
        return baseLevel + 2;
      }
      return baseLevel;
    }

    if (type === 'L' || type === 'AN' || type === 'EN') {
      return baseLevel + 1;
    }
    return baseLevel;
  });
};

export const reorderByLevels = (levels: number[]): number[] => {
  const order = levels.map((_, index) => index);
  if (levels.length === 0) {
    return order;
  }

  let highestLevel = 0;
  let lowestOddLevel = Number.POSITIVE_INFINITY;
  for (const level of levels) {
    highestLevel = Math.max(highestLevel, level);
    if ((level & 1) === 1) {
      lowestOddLevel = Math.min(lowestOddLevel, level);
    }
  }

  if (!Number.isFinite(lowestOddLevel)) {
    return order;
  }

  for (let level = highestLevel; level >= lowestOddLevel; level--) {
    let start = 0;
    while (start < order.length) {
      while (start < order.length && levels[order[start]] < level) {
        start++;
      }
      if (start >= order.length) {
        break;
      }
      let end = start + 1;
      while (end < order.length && levels[order[end]] >= level) {
        end++;
      }
      for (let left = start, right = end - 1; left < right; left++, right--) {
        [order[left], order[right]] = [order[right], order[left]];
      }
      start = end;
    }
  }

  return order;
};

export const createVisualLineLayout = (
  graphemes: string[],
  widths: number[],
  baseDirection: BaseDirection,
): VisualLineLayout => {
  const levels = resolveBidiLevels(graphemes, baseDirection);
  const visualOrder = reorderByLevels(levels);
  const clusters: VisualCluster[] = [];
  const carets: VisualCaret[] = [];
  let visualX = 0;

  for (const displayIndex of visualOrder) {
    const width = Math.max(0, widths[displayIndex] || 0);
    const isRtl = (levels[displayIndex] & 1) === 1;
    const cluster: VisualCluster = {
      displayIndex,
      visualX,
      width,
      level: levels[displayIndex],
      isRtl,
    };
    clusters.push(cluster);

    carets.push({
      displayIndex,
      visualX: isRtl ? visualX + width : visualX,
      affinity: 'before',
      clusterDisplayIndex: displayIndex,
    });
    carets.push({
      displayIndex: displayIndex + 1,
      visualX: isRtl ? visualX : visualX + width,
      affinity: 'after',
      clusterDisplayIndex: displayIndex,
    });

    visualX += width;
  }

  return {
    clusters,
    carets,
    visualOrder,
    levels,
    width: visualX,
  };
};

/**
 * Fabric's legacy pair measurement can produce negative advances for joined
 * Arabic glyphs because appending a letter reshapes the previous letter.
 * Caret geometry must remain monotonic, so fall back to positive glyph widths
 * and scale them to the measured line width whenever the cached advances are
 * not safe to use.
 */
export const normalizeVisualAdvances = (
  bounds: GraphemeAdvance[],
  lineWidth: number,
): number[] => {
  if (bounds.length === 0) {
    return [];
  }

  const measuredWidth = Math.max(0, lineWidth);
  const rawAdvances = bounds.map(({ kernedWidth }) =>
    Number.isFinite(kernedWidth) ? Math.max(0, kernedWidth || 0) : 0,
  );
  const rawTotal = rawAdvances.reduce((sum, width) => sum + width, 0);
  const hasInvalidAdvance = bounds.some(
    ({ kernedWidth }) =>
      !Number.isFinite(kernedWidth) || (kernedWidth || 0) <= 0,
  );

  let weights = rawAdvances;
  if (hasInvalidAdvance || rawTotal === 0) {
    weights = bounds.map(({ width }) =>
      Number.isFinite(width) ? Math.max(0, width || 0) : 0,
    );
  }

  let weightTotal = weights.reduce((sum, width) => sum + width, 0);
  if (weightTotal === 0) {
    weights = bounds.map(() => 1);
    weightTotal = bounds.length;
  }

  const targetWidth = measuredWidth || weightTotal;
  const scale = targetWidth / weightTotal;
  const advances = weights.map((width) => width * scale);

  // Keep the right edge bit-for-bit aligned with Fabric's measured line.
  const roundingDelta =
    targetWidth - advances.reduce((sum, width) => sum + width, 0);
  advances[advances.length - 1] += roundingDelta;
  return advances;
};

/**
 * Converts Fabric's direction-dependent line anchor into a visual offset from
 * the object's left edge.
 */
export const getVisualLineOffset = (
  objectWidth: number,
  lineWidth: number,
  lineLeftOffset: number,
  direction: BaseDirection,
): number =>
  direction === 'rtl'
    ? objectWidth + lineLeftOffset - lineWidth
    : lineLeftOffset;

/**
 * Resolve a pointer to the insertion caret belonging to the glyph half that
 * was clicked. This avoids ambiguous equal-position carets at BiDi run edges.
 */
export const hitTestVisualCaret = (
  layout: VisualLineLayout,
  x: number,
): VisualCaret => {
  const clusters = layout.clusters;
  if (clusters.length === 0) {
    return {
      displayIndex: 0,
      visualX: 0,
      affinity: 'before',
      clusterDisplayIndex: 0,
    };
  }

  const caretAtSide = (
    cluster: VisualCluster,
    side: 'left' | 'right',
  ): VisualCaret => {
    const isBefore = cluster.isRtl ? side === 'right' : side === 'left';
    return {
      displayIndex: cluster.displayIndex + (isBefore ? 0 : 1),
      visualX:
        side === 'left' ? cluster.visualX : cluster.visualX + cluster.width,
      affinity: isBefore ? 'before' : 'after',
      clusterDisplayIndex: cluster.displayIndex,
    };
  };

  const first = clusters[0];
  if (x <= first.visualX) {
    return caretAtSide(first, 'left');
  }

  for (let index = 0; index < clusters.length; index++) {
    const cluster = clusters[index];
    const right = cluster.visualX + cluster.width;
    if (x <= right) {
      return caretAtSide(
        cluster,
        x <= cluster.visualX + cluster.width / 2 ? 'left' : 'right',
      );
    }

    const next = clusters[index + 1];
    if (next && x < next.visualX) {
      return x - right <= next.visualX - x
        ? caretAtSide(cluster, 'right')
        : caretAtSide(next, 'left');
    }
  }

  return caretAtSide(clusters[clusters.length - 1], 'right');
};

export const mergeVisualIntervals = (
  intervals: Array<{ x: number; width: number }>,
  tolerance = 0.75,
): Array<{ x: number; width: number }> => {
  const sorted = intervals
    .filter(({ width }) => width > 0)
    .sort((a, b) => a.x - b.x);
  const result: Array<{ x: number; width: number }> = [];

  for (const interval of sorted) {
    const previous = result[result.length - 1];
    if (!previous) {
      result.push({ ...interval });
      continue;
    }
    const previousEnd = previous.x + previous.width;
    const intervalEnd = interval.x + interval.width;
    if (interval.x <= previousEnd + tolerance) {
      previous.width = Math.max(previousEnd, intervalEnd) - previous.x;
    } else {
      result.push({ ...interval });
    }
  }

  return result;
};

/**
 * Splits a visually measured cursive run into independent grapheme cells.
 *
 * Browsers may expose repeated Arabic tatweels as one shaping cluster even
 * though native editors still provide a caret stop for every U+0640. The run's
 * outer bounds are authoritative; equal subdivision preserves those stops
 * without changing the rendered extent.
 */
export const subdivideVisualClusterRun = (
  clusters: VisualCluster[],
  displayStart: number,
  displayEnd: number,
  visualX: number,
  width: number,
): VisualCluster[] => {
  const count = displayEnd - displayStart;
  if (count <= 0 || !Number.isFinite(width) || width <= 0) {
    return clusters;
  }

  const cellWidth = width / count;
  return clusters.map((cluster) => {
    if (
      cluster.displayIndex < displayStart ||
      cluster.displayIndex >= displayEnd
    ) {
      return cluster;
    }

    const logicalSlot = cluster.displayIndex - displayStart;
    const visualSlot = cluster.isRtl ? count - logicalSlot - 1 : logicalSlot;
    return {
      ...cluster,
      visualX: visualX + visualSlot * cellWidth,
      width: cellWidth,
    };
  });
};
