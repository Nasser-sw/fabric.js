import type { XY } from '../../Point';
import { Point } from '../../Point';
import { kRect } from '../../constants';

export interface CornerRadiusOptions {
  /**
   * Corner radius value
   */
  radius: number;
  /**
   * Whether to apply radius as percentage of the smallest dimension
   */
  radiusAsPercentage?: boolean;
}

export interface RoundedCornerPoint {
  /**
   * Original corner point
   */
  corner: XY;
  /**
   * Start point of the rounded corner arc
   */
  start: XY;
  /**
   * End point of the rounded corner arc
   */
  end: XY;
  /**
   * First control point for bezier curve
   */
  cp1: XY;
  /**
   * Second control point for bezier curve
   */
  cp2: XY;
  /**
   * Actual radius used (may be different from requested if constrained)
   */
  actualRadius: number;
}

/**
 * Calculate the distance between two points
 */
export function pointDistance(p1: XY, p2: XY): number {
  return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
}

/**
 * Normalize a vector
 */
export function normalizeVector(vector: XY): XY {
  const length = Math.sqrt(vector.x * vector.x + vector.y * vector.y);
  if (length === 0) return { x: 0, y: 0 };
  return { x: vector.x / length, y: vector.y / length };
}

/**
 * Calculate the angle between two vectors
 */
export function angleBetweenVectors(v1: XY, v2: XY): number {
  const dot = v1.x * v2.x + v1.y * v2.y;
  const det = v1.x * v2.y - v1.y * v2.x;
  return Math.atan2(det, dot);
}

/**
 * Get the maximum allowed radius for a corner based on adjacent edge lengths
 */
export function getMaxRadius(
  prevPoint: XY,
  currentPoint: XY,
  nextPoint: XY,
): number {
  const dist1 = pointDistance(prevPoint, currentPoint);
  const dist2 = pointDistance(currentPoint, nextPoint);
  return Math.min(dist1, dist2) / 2;
}

/**
 * Calculate rounded corner data for a single corner
 */
export function calculateRoundedCorner(
  prevPoint: XY,
  currentPoint: XY,
  nextPoint: XY,
  radius: number,
): RoundedCornerPoint {
  // Calculate edge vectors
  const edge1 = {
    x: currentPoint.x - prevPoint.x,
    y: currentPoint.y - prevPoint.y,
  };
  const edge2 = {
    x: nextPoint.x - currentPoint.x,
    y: nextPoint.y - currentPoint.y,
  };

  // Normalize edge vectors
  const norm1 = normalizeVector(edge1);
  const norm2 = normalizeVector(edge2);

  // Calculate the maximum allowed radius
  const maxRadius = getMaxRadius(prevPoint, currentPoint, nextPoint);
  const actualRadius = Math.min(radius, maxRadius);

  // Calculate start and end points of the rounded corner
  const startPoint = {
    x: currentPoint.x - norm1.x * actualRadius,
    y: currentPoint.y - norm1.y * actualRadius,
  };

  const endPoint = {
    x: currentPoint.x + norm2.x * actualRadius,
    y: currentPoint.y + norm2.y * actualRadius,
  };

  // Calculate control points for bezier curve
  // Using the magic number kRect for optimal circular approximation
  const controlOffset = actualRadius * kRect;

  const cp1 = {
    x: startPoint.x + norm1.x * controlOffset,
    y: startPoint.y + norm1.y * controlOffset,
  };

  const cp2 = {
    x: endPoint.x - norm2.x * controlOffset,
    y: endPoint.y - norm2.y * controlOffset,
  };

  return {
    corner: currentPoint,
    start: startPoint,
    end: endPoint,
    cp1,
    cp2,
    actualRadius,
  };
}

/**
 * Apply corner radius to a polygon defined by points
 */
export function applyCornerRadiusToPolygon(
  points: XY[],
  radius: number,
  radiusAsPercentage = false,
): RoundedCornerPoint[] {
  if (points.length < 3) {
    throw new Error('Polygon must have at least 3 points');
  }

  // Calculate bounding box if radius is percentage-based
  let actualRadius = radius;
  if (radiusAsPercentage) {
    const minX = Math.min(...points.map((p) => p.x));
    const maxX = Math.max(...points.map((p) => p.x));
    const minY = Math.min(...points.map((p) => p.y));
    const maxY = Math.max(...points.map((p) => p.y));
    const width = maxX - minX;
    const height = maxY - minY;
    const minDimension = Math.min(width, height);
    actualRadius = (radius / 100) * minDimension;
  }

  const roundedCorners: RoundedCornerPoint[] = [];

  for (let i = 0; i < points.length; i++) {
    const prevIndex = (i - 1 + points.length) % points.length;
    const nextIndex = (i + 1) % points.length;

    const prevPoint = points[prevIndex];
    const currentPoint = points[i];
    const nextPoint = points[nextIndex];

    const roundedCorner = calculateRoundedCorner(
      prevPoint,
      currentPoint,
      nextPoint,
      actualRadius,
    );

    roundedCorners.push(roundedCorner);
  }

  return roundedCorners;
}

/**
 * Render a rounded polygon to a canvas context
 */
export function renderRoundedPolygon(
  ctx: CanvasRenderingContext2D,
  roundedCorners: RoundedCornerPoint[],
  closed = true,
) {
  if (roundedCorners.length === 0) return;

  ctx.beginPath();

  // Start at the first corner's start point
  const firstCorner = roundedCorners[0];
  ctx.moveTo(firstCorner.start.x, firstCorner.start.y);

  for (let i = 0; i < roundedCorners.length; i++) {
    const corner = roundedCorners[i];
    const nextIndex = (i + 1) % roundedCorners.length;
    const nextCorner = roundedCorners[nextIndex];

    // Draw the rounded corner using bezier curve
    ctx.bezierCurveTo(
      corner.cp1.x,
      corner.cp1.y,
      corner.cp2.x,
      corner.cp2.y,
      corner.end.x,
      corner.end.y,
    );

    // Draw line to next corner's start point (if not the last segment in open path)
    if (i < roundedCorners.length - 1 || closed) {
      ctx.lineTo(nextCorner.start.x, nextCorner.start.y);
    }
  }

  if (closed) {
    ctx.closePath();
  }
}

/**
 * Generate SVG path data for a rounded polygon
 */
export function generateRoundedPolygonPath(
  roundedCorners: RoundedCornerPoint[],
  closed = true,
): string {
  if (roundedCorners.length === 0) return '';

  const pathData: string[] = [];
  const firstCorner = roundedCorners[0];

  // Move to first corner's start point
  pathData.push(`M ${firstCorner.start.x} ${firstCorner.start.y}`);

  for (let i = 0; i < roundedCorners.length; i++) {
    const corner = roundedCorners[i];
    const nextIndex = (i + 1) % roundedCorners.length;
    const nextCorner = roundedCorners[nextIndex];

    // Add bezier curve for the rounded corner
    pathData.push(
      `C ${corner.cp1.x} ${corner.cp1.y} ${corner.cp2.x} ${corner.cp2.y} ${corner.end.x} ${corner.end.y}`,
    );

    // Add line to next corner's start point (if not the last segment in open path)
    if (i < roundedCorners.length - 1 || closed) {
      pathData.push(`L ${nextCorner.start.x} ${nextCorner.start.y}`);
    }
  }

  if (closed) {
    pathData.push('Z');
  }

  return pathData.join(' ');
}