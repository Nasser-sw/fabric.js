import type {
  TransformActionHandler,
  TPointerEvent,
  Transform,
} from '../EventTypeDefs';
import { Point } from '../Point';
import type { InteractiveFabricObject } from '../shapes/Object/InteractiveObject';
import type { TMat2D } from '../typedefs';
import { Control } from './Control';
import { degreesToRadians } from '../util/misc/radiansDegreesConversion';
import { CENTER } from '../constants';
import { getLocalPoint } from './util';

/**
 * Expansion state for AI outpainting
 */
export interface ExpansionState {
  expandLeft: number;
  expandRight: number;
  expandTop: number;
  expandBottom: number;
}

/**
 * Direction(s) that an expand control affects
 */
export type ExpandDirection = 'left' | 'right' | 'top' | 'bottom';

/**
 * Styling constants for expand controls
 */
export const EXPAND_HANDLE_FILL = '#ffffff';
export const EXPAND_HANDLE_STROKE = '#8b5cf6'; // Purple
export const EXPAND_PREVIEW_FILL = 'rgba(139, 92, 246, 0.1)';
export const EXPAND_PREVIEW_STROKE = '#8b5cf6';
export const EXPAND_PREVIEW_DASH = [6, 4];

// Handle sizes - similar to default Fabric controls
const EDGE_HANDLE_WIDTH = 6;
const EDGE_HANDLE_HEIGHT = 20;
const CORNER_HANDLE_SIZE = 10;
const HANDLE_RADIUS = 2;

/**
 * Default expansion state
 */
export const createDefaultExpansion = (): ExpansionState => ({
  expandLeft: 0,
  expandRight: 0,
  expandTop: 0,
  expandBottom: 0,
});

/**
 * Get expansion state from object, initializing if needed
 */
export function getExpansion(obj: InteractiveFabricObject): ExpansionState {
  if (!(obj as any).expansion) {
    (obj as any).expansion = createDefaultExpansion();
  }
  return (obj as any).expansion;
}

/**
 * Set expansion state on object
 */
export function setExpansion(
  obj: InteractiveFabricObject,
  expansion: Partial<ExpansionState>,
): void {
  const current = getExpansion(obj);
  Object.assign(current, expansion);
}

/**
 * Custom control for AI expansion handles
 */
export class ExpandControl extends Control {
  /**
   * Which direction(s) this control affects
   */
  declare expandDirections: ExpandDirection[];

  constructor(
    options: Partial<ExpandControl> & { expandDirections: ExpandDirection[] },
  ) {
    super(options);
    this.expandDirections = options.expandDirections;
    this.actionName = 'expand';
  }

  /**
   * Position handler for expand controls
   * Positions controls at the expansion boundary, not the object boundary
   * Note: expansion values are stored in screen pixels (already scaled)
   */
  positionHandler(
    dim: Point,
    finalMatrix: TMat2D,
    fabricObject: InteractiveFabricObject,
    currentControl: Control,
  ): Point {
    const expansion = getExpansion(fabricObject);
    const { expandLeft, expandRight, expandTop, expandBottom } = expansion;

    // dim already includes scale, so use it directly for base size
    // expansion values are also in screen pixels, so use directly
    const halfWidth = dim.x / 2;
    const halfHeight = dim.y / 2;

    // Calculate the expanded half dimensions
    const expandedHalfWidth = halfWidth + (expandLeft + expandRight) / 2;
    const expandedHalfHeight = halfHeight + (expandTop + expandBottom) / 2;

    // Calculate offset from center based on asymmetric expansion
    const centerOffsetX = (expandRight - expandLeft) / 2;
    const centerOffsetY = (expandBottom - expandTop) / 2;

    let posX: number;
    let posY: number;

    // Position based on which side this control is on
    if (this.x < 0) {
      // Left side controls
      posX = -expandedHalfWidth + centerOffsetX;
    } else if (this.x > 0) {
      // Right side controls
      posX = expandedHalfWidth + centerOffsetX;
    } else {
      // Center (top/bottom only)
      posX = centerOffsetX;
    }

    if (this.y < 0) {
      // Top side controls
      posY = -expandedHalfHeight + centerOffsetY;
    } else if (this.y > 0) {
      // Bottom side controls
      posY = expandedHalfHeight + centerOffsetY;
    } else {
      // Center (left/right only)
      posY = centerOffsetY;
    }

    return new Point(posX, posY).transform(finalMatrix);
  }

  /**
   * Custom render for expand handles - purple border with white fill
   */
  render(
    ctx: CanvasRenderingContext2D,
    left: number,
    top: number,
    styleOverride: any,
    fabricObject: InteractiveFabricObject,
  ): void {
    ctx.save();
    ctx.translate(left, top);

    const angle = fabricObject.getTotalAngle();
    ctx.rotate(degreesToRadians(angle));

    // Add subtle shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
    ctx.shadowBlur = 3;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 1;

    ctx.fillStyle = EXPAND_HANDLE_FILL;
    ctx.strokeStyle = EXPAND_HANDLE_STROKE;
    ctx.lineWidth = 2;

    // Determine if this is a corner or edge control
    const isCorner = this.x !== 0 && this.y !== 0;

    if (isCorner) {
      // Corner: draw a circle
      ctx.beginPath();
      ctx.arc(0, 0, CORNER_HANDLE_SIZE / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (this.y === 0) {
      // Horizontal edge (left/right): vertical pill
      ctx.beginPath();
      ctx.roundRect(
        -EDGE_HANDLE_WIDTH / 2,
        -EDGE_HANDLE_HEIGHT / 2,
        EDGE_HANDLE_WIDTH,
        EDGE_HANDLE_HEIGHT,
        HANDLE_RADIUS,
      );
      ctx.fill();
      ctx.stroke();
    } else {
      // Vertical edge (top/bottom): horizontal pill
      ctx.beginPath();
      ctx.roundRect(
        -EDGE_HANDLE_HEIGHT / 2,
        -EDGE_HANDLE_WIDTH / 2,
        EDGE_HANDLE_HEIGHT,
        EDGE_HANDLE_WIDTH,
        HANDLE_RADIUS,
      );
      ctx.fill();
      ctx.stroke();
    }

    ctx.restore();
  }
}

/**
 * Action handler for expanding left edge
 */
export const expandLeftHandler: TransformActionHandler = (
  eventData: TPointerEvent,
  transform: Transform,
  x: number,
  y: number,
): boolean => {
  const { target } = transform;
  const expansion = getExpansion(target as InteractiveFabricObject);

  // Use Fabric's getLocalPoint with center origin (returns scaled coordinates)
  const localPoint = getLocalPoint(transform, CENTER, CENTER, x, y);

  // Use SCALED half width since localPoint is in scaled coords
  const scaleX = target.scaleX || 1;
  const scaledHalfWidth = (target.width * scaleX) / 2;

  // Calculate new expansion (how far left of the object's left edge)
  // localPoint.x is negative when left of center
  // Expansion starts when localPoint.x < -scaledHalfWidth
  const newExpandLeft = Math.max(0, -scaledHalfWidth - localPoint.x);

  if (Math.abs(newExpandLeft - expansion.expandLeft) > 0.5) {
    expansion.expandLeft = newExpandLeft;
    target.setCoords();
    target.canvas?.requestRenderAll();
    return true;
  }
  return false;
};

/**
 * Action handler for expanding right edge
 */
export const expandRightHandler: TransformActionHandler = (
  eventData: TPointerEvent,
  transform: Transform,
  x: number,
  y: number,
): boolean => {
  const { target } = transform;
  const expansion = getExpansion(target as InteractiveFabricObject);

  // Use Fabric's getLocalPoint with center origin (returns scaled coordinates)
  const localPoint = getLocalPoint(transform, CENTER, CENTER, x, y);

  // Use SCALED half width since localPoint is in scaled coords
  const scaleX = target.scaleX || 1;
  const scaledHalfWidth = (target.width * scaleX) / 2;

  // Calculate new expansion (how far right of the object's right edge)
  // localPoint.x is positive when right of center
  // Expansion starts when localPoint.x > scaledHalfWidth
  const newExpandRight = Math.max(0, localPoint.x - scaledHalfWidth);

  if (Math.abs(newExpandRight - expansion.expandRight) > 0.5) {
    expansion.expandRight = newExpandRight;
    target.setCoords();
    target.canvas?.requestRenderAll();
    return true;
  }
  return false;
};

/**
 * Action handler for expanding top edge
 */
export const expandTopHandler: TransformActionHandler = (
  eventData: TPointerEvent,
  transform: Transform,
  x: number,
  y: number,
): boolean => {
  const { target } = transform;
  const expansion = getExpansion(target as InteractiveFabricObject);

  // Use Fabric's getLocalPoint with center origin (returns scaled coordinates)
  const localPoint = getLocalPoint(transform, CENTER, CENTER, x, y);

  // Use SCALED half height since localPoint is in scaled coords
  const scaleY = target.scaleY || 1;
  const scaledHalfHeight = (target.height * scaleY) / 2;

  // Calculate new expansion (how far above the object's top edge)
  const newExpandTop = Math.max(0, -scaledHalfHeight - localPoint.y);

  if (Math.abs(newExpandTop - expansion.expandTop) > 0.5) {
    expansion.expandTop = newExpandTop;
    target.setCoords();
    target.canvas?.requestRenderAll();
    return true;
  }
  return false;
};

/**
 * Action handler for expanding bottom edge
 */
export const expandBottomHandler: TransformActionHandler = (
  eventData: TPointerEvent,
  transform: Transform,
  x: number,
  y: number,
): boolean => {
  const { target } = transform;
  const expansion = getExpansion(target as InteractiveFabricObject);

  // Use Fabric's getLocalPoint with center origin (returns scaled coordinates)
  const localPoint = getLocalPoint(transform, CENTER, CENTER, x, y);

  // Use SCALED half height since localPoint is in scaled coords
  const scaleY = target.scaleY || 1;
  const scaledHalfHeight = (target.height * scaleY) / 2;

  // Calculate new expansion (how far below the object's bottom edge)
  const newExpandBottom = Math.max(0, localPoint.y - scaledHalfHeight);

  if (Math.abs(newExpandBottom - expansion.expandBottom) > 0.5) {
    expansion.expandBottom = newExpandBottom;
    target.setCoords();
    target.canvas?.requestRenderAll();
    return true;
  }
  return false;
};

/**
 * Combined handler for corner controls (affects two directions)
 */
function createCornerExpandHandler(
  horizontalHandler: TransformActionHandler,
  verticalHandler: TransformActionHandler,
): TransformActionHandler {
  return (
    eventData: TPointerEvent,
    transform: Transform,
    x: number,
    y: number,
  ): boolean => {
    const h = horizontalHandler(eventData, transform, x, y);
    const v = verticalHandler(eventData, transform, x, y);
    return h || v;
  };
}

/**
 * Cursor style handler for expand controls
 */
function expandCursorStyleHandler(
  eventData: TPointerEvent,
  control: Control,
  fabricObject: InteractiveFabricObject,
): string {
  const expandControl = control as ExpandControl;
  const directions = expandControl.expandDirections;

  // Determine cursor based on direction
  if (directions.includes('left') && directions.includes('right')) {
    return 'ew-resize';
  }
  if (directions.includes('top') && directions.includes('bottom')) {
    return 'ns-resize';
  }
  if (directions.includes('left') || directions.includes('right')) {
    return 'ew-resize';
  }
  if (directions.includes('top') || directions.includes('bottom')) {
    return 'ns-resize';
  }
  if (directions.length === 2) {
    // Corner
    if (
      (directions.includes('left') && directions.includes('top')) ||
      (directions.includes('right') && directions.includes('bottom'))
    ) {
      return 'nwse-resize';
    }
    return 'nesw-resize';
  }

  return 'move';
}

/**
 * Create the set of expand controls for an object
 */
export function createExpandControls(): Record<string, Control> {
  return {
    // Edge controls
    ml: new ExpandControl({
      x: -0.5,
      y: 0,
      expandDirections: ['left'],
      actionHandler: expandLeftHandler,
      cursorStyleHandler: expandCursorStyleHandler,
      sizeX: EDGE_HANDLE_WIDTH,
      sizeY: EDGE_HANDLE_HEIGHT,
    }),
    mr: new ExpandControl({
      x: 0.5,
      y: 0,
      expandDirections: ['right'],
      actionHandler: expandRightHandler,
      cursorStyleHandler: expandCursorStyleHandler,
      sizeX: EDGE_HANDLE_WIDTH,
      sizeY: EDGE_HANDLE_HEIGHT,
    }),
    mt: new ExpandControl({
      x: 0,
      y: -0.5,
      expandDirections: ['top'],
      actionHandler: expandTopHandler,
      cursorStyleHandler: expandCursorStyleHandler,
      sizeX: EDGE_HANDLE_HEIGHT,
      sizeY: EDGE_HANDLE_WIDTH,
    }),
    mb: new ExpandControl({
      x: 0,
      y: 0.5,
      expandDirections: ['bottom'],
      actionHandler: expandBottomHandler,
      cursorStyleHandler: expandCursorStyleHandler,
      sizeX: EDGE_HANDLE_HEIGHT,
      sizeY: EDGE_HANDLE_WIDTH,
    }),

    // Corner controls
    tl: new ExpandControl({
      x: -0.5,
      y: -0.5,
      expandDirections: ['left', 'top'],
      actionHandler: createCornerExpandHandler(
        expandLeftHandler,
        expandTopHandler,
      ),
      cursorStyleHandler: expandCursorStyleHandler,
      sizeX: CORNER_HANDLE_SIZE,
      sizeY: CORNER_HANDLE_SIZE,
    }),
    tr: new ExpandControl({
      x: 0.5,
      y: -0.5,
      expandDirections: ['right', 'top'],
      actionHandler: createCornerExpandHandler(
        expandRightHandler,
        expandTopHandler,
      ),
      cursorStyleHandler: expandCursorStyleHandler,
      sizeX: CORNER_HANDLE_SIZE,
      sizeY: CORNER_HANDLE_SIZE,
    }),
    bl: new ExpandControl({
      x: -0.5,
      y: 0.5,
      expandDirections: ['left', 'bottom'],
      actionHandler: createCornerExpandHandler(
        expandLeftHandler,
        expandBottomHandler,
      ),
      cursorStyleHandler: expandCursorStyleHandler,
      sizeX: CORNER_HANDLE_SIZE,
      sizeY: CORNER_HANDLE_SIZE,
    }),
    br: new ExpandControl({
      x: 0.5,
      y: 0.5,
      expandDirections: ['right', 'bottom'],
      actionHandler: createCornerExpandHandler(
        expandRightHandler,
        expandBottomHandler,
      ),
      cursorStyleHandler: expandCursorStyleHandler,
      sizeX: CORNER_HANDLE_SIZE,
      sizeY: CORNER_HANDLE_SIZE,
    }),
  };
}
