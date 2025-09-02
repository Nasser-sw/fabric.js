/**
 * Advanced Text Measurement System
 * 
 * Provides precise text measurement with caching, font metrics,
 * and DPI awareness for optimal performance and accuracy.
 */

import { createCanvasElementFor } from '../util/misc/dom';

export interface MeasurementOptions {
  fontFamily: string;
  fontSize: number;
  fontStyle: string;
  fontWeight: string | number;
  letterSpacing?: number;
  direction?: 'ltr' | 'rtl';
}

export interface GraphemeMeasurement {
  width: number;
  height: number;
  ascent: number;
  descent: number;
  baseline: number;
}

export interface KerningMeasurement extends GraphemeMeasurement {
  kernedWidth: number; // width accounting for kerning with previous char
}

export interface FontMetrics {
  ascent: number;
  descent: number;
  lineHeight: number;
  baseline: string;
  fontBoundingBoxAscent?: number;
  fontBoundingBoxDescent?: number;
  actualBoundingBoxAscent?: number;
  actualBoundingBoxDescent?: number;
}

// Global measurement context - reused for performance
let measurementContext: CanvasRenderingContext2D | null = null;

/**
 * Get or create the shared measurement context
 */
function getMeasurementContext(): CanvasRenderingContext2D {
  if (!measurementContext) {
    const canvas = createCanvasElementFor({
      width: 0,
      height: 0,
    });
    measurementContext = canvas.getContext('2d')!;
  }
  return measurementContext;
}

/**
 * Measure a single grapheme
 */
export function measureGrapheme(
  grapheme: string,
  options: MeasurementOptions,
  ctx?: CanvasRenderingContext2D
): GraphemeMeasurement {
  // Check cache first
  const cached = measurementCache.get(grapheme, options);
  if (cached) {
    return cached;
  }

  // Use provided context or get global one
  const context = ctx || getMeasurementContext();
  
  // Set font properties
  applyFontStyle(context, options);
  
  // Measure the grapheme
  const metrics = context.measureText(grapheme);
  const fontMetrics = getFontMetrics(options);
  
  // Calculate comprehensive measurements
  const measurement: GraphemeMeasurement = {
    width: metrics.width,
    height: fontMetrics.lineHeight,
    ascent: fontMetrics.ascent,
    descent: fontMetrics.descent,
    baseline: fontMetrics.ascent,
  };
  
  // Cache the result
  measurementCache.set(grapheme, options, measurement);
  
  return measurement;
}

/**
 * Measure a grapheme with kerning relative to previous character
 */
export function measureGraphemeWithKerning(
  grapheme: string,
  previousGrapheme: string | undefined,
  options: MeasurementOptions,
  ctx?: CanvasRenderingContext2D
): KerningMeasurement {
  // Get individual measurement
  const individual = measureGrapheme(grapheme, options, ctx);
  
  // If no previous character, kerning width equals regular width
  if (!previousGrapheme) {
    return {
      ...individual,
      kernedWidth: individual.width,
    };
  }
  
  // Check kerning cache
  const kerningPair = `${previousGrapheme}${grapheme}`;
  const cachedKerning = kerningCache.get(kerningPair, options);
  if (cachedKerning) {
    return {
      ...individual,
      kernedWidth: cachedKerning,
    };
  }
  
  // Use provided context or get global one
  const context = ctx || getMeasurementContext();
  applyFontStyle(context, options);
  
  // Measure the pair
  const pairWidth = context.measureText(previousGrapheme + grapheme).width;
  const previousWidth = measureGrapheme(previousGrapheme, options, context).width;
  const kernedWidth = pairWidth - previousWidth;
  
  // Cache kerning result
  kerningCache.set(kerningPair, options, kernedWidth);
  
  return {
    ...individual,
    kernedWidth,
  };
}

/**
 * Get font metrics for layout calculations
 */
export function getFontMetrics(options: MeasurementOptions): FontMetrics {
  const cacheKey = getFontDeclaration(options);
  const cached = fontMetricsCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  
  const context = getMeasurementContext();
  applyFontStyle(context, options);
  
  // Use 'M' as sample character for metrics
  const metrics = context.measureText('M');
  const fontSize = options.fontSize;
  
  // Calculate metrics with fallbacks
  const fontBoundingBoxAscent = metrics.fontBoundingBoxAscent ?? fontSize * 0.91;
  const fontBoundingBoxDescent = metrics.fontBoundingBoxDescent ?? fontSize * 0.21;
  const actualBoundingBoxAscent = metrics.actualBoundingBoxAscent ?? fontSize * 0.716;
  const actualBoundingBoxDescent = metrics.actualBoundingBoxDescent ?? 0;
  
  const result: FontMetrics = {
    ascent: fontBoundingBoxAscent,
    descent: fontBoundingBoxDescent,
    lineHeight: fontSize,
    baseline: 'alphabetic',
    fontBoundingBoxAscent,
    fontBoundingBoxDescent,
    actualBoundingBoxAscent,
    actualBoundingBoxDescent,
  };
  
  fontMetricsCache.set(cacheKey, result);
  return result;
}

/**
 * Apply font styling to canvas context
 */
function applyFontStyle(ctx: CanvasRenderingContext2D, options: MeasurementOptions): void {
  const fontDeclaration = getFontDeclaration(options);
  ctx.font = fontDeclaration;
  
  if (options.letterSpacing) {
    // Modern browsers support letterSpacing
    if ('letterSpacing' in ctx) {
      (ctx as any).letterSpacing = `${options.letterSpacing}px`;
    }
  }
  
  if (options.direction) {
    ctx.direction = options.direction;
  }
  
  ctx.textBaseline = 'alphabetic';
}

/**
 * Generate font declaration string
 */
function getFontDeclaration(options: MeasurementOptions): string {
  const { fontStyle, fontWeight, fontSize, fontFamily } = options;
  
  // Normalize font family (add quotes if needed)
  const normalizedFamily = fontFamily.includes(' ') && 
    !fontFamily.includes('"') && 
    !fontFamily.includes("'")
    ? `"${fontFamily}"`
    : fontFamily;
  
  return `${fontStyle} ${fontWeight} ${fontSize}px ${normalizedFamily}`;
}

/**
 * LRU Cache implementation for measurements
 */
class LRUCache<T> {
  private cache = new Map<string, { value: T; timestamp: number }>();
  private maxSize: number;
  private hits = 0;
  private misses = 0;

  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (entry) {
      // Update timestamp for LRU
      entry.timestamp = Date.now();
      this.hits++;
      return entry.value;
    }
    this.misses++;
    return undefined;
  }

  set(key: string, value: T): void {
    // Remove oldest entries if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.findOldestKey();
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now(),
    });
  }

  private findOldestKey(): string | undefined {
    let oldestKey: string | undefined;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }

    return oldestKey;
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  getStats(): { size: number; hitRate: number; hits: number; misses: number } {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      hitRate: total > 0 ? this.hits / total : 0,
      hits: this.hits,
      misses: this.misses,
    };
  }
}

/**
 * Advanced measurement cache with font-aware keys
 */
export class MeasurementCache {
  private cache = new LRUCache<GraphemeMeasurement>(1000);

  getCacheKey(grapheme: string, options: MeasurementOptions): string {
    const fontDecl = getFontDeclaration(options);
    const letterSpacing = options.letterSpacing || 0;
    return `${fontDecl}|${grapheme}|${letterSpacing}`;
  }

  get(grapheme: string, options: MeasurementOptions): GraphemeMeasurement | undefined {
    const key = this.getCacheKey(grapheme, options);
    return this.cache.get(key);
  }

  set(grapheme: string, options: MeasurementOptions, measurement: GraphemeMeasurement): void {
    const key = this.getCacheKey(grapheme, options);
    this.cache.set(key, measurement);
  }

  clear(): void {
    this.cache.clear();
  }

  getStats() {
    return this.cache.getStats();
  }
}

/**
 * Kerning cache for character pairs
 */
class KerningCache {
  private cache = new LRUCache<number>(5000); // More entries for pairs

  getCacheKey(pair: string, options: MeasurementOptions): string {
    const fontDecl = getFontDeclaration(options);
    return `${fontDecl}|${pair}`;
  }

  get(pair: string, options: MeasurementOptions): number | undefined {
    const key = this.getCacheKey(pair, options);
    return this.cache.get(key);
  }

  set(pair: string, options: MeasurementOptions, kerning: number): void {
    const key = this.getCacheKey(pair, options);
    this.cache.set(key, kerning);
  }

  clear(): void {
    this.cache.clear();
  }

  getStats() {
    return this.cache.getStats();
  }
}

/**
 * Font metrics cache
 */
class FontMetricsCache {
  private cache = new Map<string, FontMetrics>();

  get(fontDeclaration: string): FontMetrics | undefined {
    return this.cache.get(fontDeclaration);
  }

  set(fontDeclaration: string, metrics: FontMetrics): void {
    this.cache.set(fontDeclaration, metrics);
  }

  clear(): void {
    this.cache.clear();
  }

  getStats() {
    return {
      size: this.cache.size,
    };
  }
}

// Global cache instances
export const measurementCache = new MeasurementCache();
export const kerningCache = new KerningCache();
export const fontMetricsCache = new FontMetricsCache();

/**
 * Clear all measurement caches
 */
export function clearAllCaches(): void {
  measurementCache.clear();
  kerningCache.clear();
  fontMetricsCache.clear();
}

/**
 * Get combined cache statistics
 */
export function getCacheStats() {
  return {
    measurement: measurementCache.getStats(),
    kerning: kerningCache.getStats(),
    fontMetrics: fontMetricsCache.getStats(),
  };
}

/**
 * Batch measure multiple graphemes efficiently
 */
export function batchMeasureGraphemes(
  graphemes: string[],
  options: MeasurementOptions,
  ctx?: CanvasRenderingContext2D
): GraphemeMeasurement[] {
  const context = ctx || getMeasurementContext();
  applyFontStyle(context, options);
  
  // Separate cached and uncached measurements
  const results: GraphemeMeasurement[] = new Array(graphemes.length);
  const uncachedIndices: number[] = [];
  
  // Check cache for all graphemes
  graphemes.forEach((grapheme, index) => {
    const cached = measurementCache.get(grapheme, options);
    if (cached) {
      results[index] = cached;
    } else {
      uncachedIndices.push(index);
    }
  });
  
  // Measure uncached graphemes
  const fontMetrics = getFontMetrics(options);
  uncachedIndices.forEach(index => {
    const grapheme = graphemes[index];
    const metrics = context.measureText(grapheme);
    
    const measurement: GraphemeMeasurement = {
      width: metrics.width,
      height: fontMetrics.lineHeight,
      ascent: fontMetrics.ascent,
      descent: fontMetrics.descent,
      baseline: fontMetrics.ascent,
    };
    
    measurementCache.set(grapheme, options, measurement);
    results[index] = measurement;
  });
  
  return results;
}

/**
 * Estimate text width without full layout (for performance)
 */
export function estimateTextWidth(
  text: string,
  options: MeasurementOptions
): number {
  // Use average character width for estimation
  const avgChar = 'n'; // Representative character
  const avgMeasurement = measureGrapheme(avgChar, options);
  const letterSpacing = options.letterSpacing || 0;
  
  return text.length * (avgMeasurement.width + letterSpacing);
}

/**
 * Check if font is loaded and ready for measurement
 */
export function isFontReady(fontFamily: string): boolean {
  if (typeof document === 'undefined') return true;
  
  if ('fonts' in document) {
    return document.fonts.check(`16px ${fontFamily}`);
  }
  
  // Fallback - assume font is ready
  return true;
}