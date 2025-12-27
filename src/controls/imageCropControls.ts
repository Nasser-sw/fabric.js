import type { TPointerEvent, Transform, TransformActionHandler } from '../EventTypeDefs';
import type { FabricImage } from '../shapes/Image';
import { RESIZING, ROTATE } from '../constants';
import { Control } from './Control';
import {
  renderHorizontalPillControl,
  renderVerticalPillControl,
} from './controlRendering';
import { rotationStyleHandler, rotationWithSnapping } from './rotate';
import { scaleCursorStyleHandler, scalingEqually } from './scale';
import { scaleSkewCursorStyleHandler } from './scaleSkew';
import { getLocalPoint } from './util';
import { wrapWithFireEvent } from './wrapWithFireEvent';
import { wrapWithFixedAnchor } from './wrapWithFixedAnchor';

/**
 * Minimum size for cropped images (in pixels)
 */
const MIN_SIZE = 20;

/**
 * Get the original element dimensions for an image
 */
function getOriginalDimensions(target: FabricImage): { width: number; height: number } {
  const element = target.getElement() as HTMLImageElement;
  if (!element) {
    return { width: target.width || 100, height: target.height || 100 };
  }
  return {
    width: element.naturalWidth || element.width || target.width || 100,
    height: element.naturalHeight || element.height || target.height || 100,
  };
}

/**
 * Handler for resizing from RIGHT edge (mr control) - Canva style
 * Crops from right side, anchor on left
 */
const resizeFromRightHandler: TransformActionHandler = (
  eventData: TPointerEvent,
  transform: Transform,
  x: number,
  y: number,
): boolean => {
  const target = transform.target as FabricImage;
  const original = getOriginalDimensions(target);
  const currentScale = target.scaleX || 1;
  const cropX = target.cropX || 0;

  const localPoint = getLocalPoint(
    transform,
    transform.originX,
    transform.originY,
    x,
    y,
  );

  const requestedVisualWidth = Math.max(MIN_SIZE, Math.abs(localPoint.x));
  const maxAvailableWidth = (original.width - cropX) * currentScale;

  if (requestedVisualWidth <= maxAvailableWidth) {
    // Within bounds - just change visible width, cropX stays same (crops from right)
    target.width = requestedVisualWidth / currentScale;
  } else {
    // Beyond bounds - scale uniformly
    target.width = original.width - cropX;
    const newScale = requestedVisualWidth / target.width;
    target.scaleX = newScale;
    target.scaleY = newScale;
    const currentVisualHeight = (target.height || original.height) * currentScale;
    target.height = currentVisualHeight / newScale;
  }

  target.setCoords();
  return true;
};

/**
 * Handler for resizing from LEFT edge (ml control) - Canva style
 * Crops from left side, anchor on right
 */
const resizeFromLeftHandler: TransformActionHandler = (
  eventData: TPointerEvent,
  transform: Transform,
  x: number,
  y: number,
): boolean => {
  const target = transform.target as FabricImage;
  const original = getOriginalDimensions(target);
  const currentScale = target.scaleX || 1;
  const currentCropX = target.cropX || 0;
  const currentWidth = target.width || original.width;

  const localPoint = getLocalPoint(
    transform,
    transform.originX,
    transform.originY,
    x,
    y,
  );

  const requestedVisualWidth = Math.max(MIN_SIZE, Math.abs(localPoint.x));
  const currentVisualWidth = currentWidth * currentScale;

  // Right edge position in original image coords (stays fixed)
  const rightEdgeInOriginal = currentCropX + currentWidth;

  // Maximum we can expand to the left (cropX can go to 0)
  const maxAvailableWidth = rightEdgeInOriginal * currentScale;

  if (requestedVisualWidth <= maxAvailableWidth) {
    // Within bounds - adjust cropX and width (crops from left)
    const newWidthUnscaled = requestedVisualWidth / currentScale;
    const newCropX = rightEdgeInOriginal - newWidthUnscaled;

    if (newCropX >= 0) {
      target.cropX = newCropX;
      target.width = newWidthUnscaled;
    } else {
      // Hit left boundary
      target.cropX = 0;
      target.width = rightEdgeInOriginal;
    }
  } else {
    // Beyond bounds - scale uniformly
    target.cropX = 0;
    target.width = rightEdgeInOriginal;
    const newScale = requestedVisualWidth / target.width;
    target.scaleX = newScale;
    target.scaleY = newScale;
    const currentVisualHeight = (target.height || original.height) * currentScale;
    target.height = currentVisualHeight / newScale;
  }

  target.setCoords();
  return true;
};

/**
 * Handler for cropping from the right edge (mr control) - for crop mode
 * - Drag inward: decrease width (crop right side)
 * - Drag outward: increase width until hitting boundary, then scale
 */
const cropFromRightHandler: TransformActionHandler = (
  eventData: TPointerEvent,
  transform: Transform,
  x: number,
  y: number,
): boolean => {
  const target = transform.target as FabricImage;
  const localPoint = getLocalPoint(transform, 'left', 'center', x, y);

  const original = getOriginalDimensions(target);
  const currentCropX = target.cropX || 0;
  const currentScale = target.scaleX || 1;

  // Maximum visible width at current scale (from current cropX to right edge of original)
  const maxVisibleWidth = (original.width - currentCropX) * currentScale;

  // Requested width based on mouse position
  const requestedWidth = Math.max(MIN_SIZE, localPoint.x);

  if (requestedWidth <= maxVisibleWidth) {
    // Within bounds - just change visible width (crop/uncrop)
    // Convert to unscaled width for the width property
    target.width = requestedWidth / currentScale;
  } else {
    // Beyond bounds - need to scale
    // First, set width to maximum possible
    target.width = original.width - currentCropX;
    // Calculate new scale to reach requested size
    const newScale = requestedWidth / target.width;
    target.scaleX = newScale;
    target.scaleY = newScale; // Uniform scaling
  }

  target.setCoords();
  return true;
};

/**
 * Handler for resizing from BOTTOM edge (mb control) - Canva style
 * Crops from bottom side, anchor on top
 */
const resizeFromBottomHandler: TransformActionHandler = (
  eventData: TPointerEvent,
  transform: Transform,
  x: number,
  y: number,
): boolean => {
  const target = transform.target as FabricImage;
  const original = getOriginalDimensions(target);
  const currentScale = target.scaleY || 1;
  const cropY = target.cropY || 0;

  const localPoint = getLocalPoint(
    transform,
    transform.originX,
    transform.originY,
    x,
    y,
  );

  const requestedVisualHeight = Math.max(MIN_SIZE, Math.abs(localPoint.y));
  const maxAvailableHeight = (original.height - cropY) * currentScale;

  if (requestedVisualHeight <= maxAvailableHeight) {
    // Within bounds - just change visible height, cropY stays same (crops from bottom)
    target.height = requestedVisualHeight / currentScale;
  } else {
    // Beyond bounds - scale uniformly
    target.height = original.height - cropY;
    const newScale = requestedVisualHeight / target.height;
    target.scaleX = newScale;
    target.scaleY = newScale;
    const currentVisualWidth = (target.width || original.width) * currentScale;
    target.width = currentVisualWidth / newScale;
  }

  target.setCoords();
  return true;
};

/**
 * Handler for resizing from TOP edge (mt control) - Canva style
 * Crops from top side, anchor on bottom
 */
const resizeFromTopHandler: TransformActionHandler = (
  eventData: TPointerEvent,
  transform: Transform,
  x: number,
  y: number,
): boolean => {
  const target = transform.target as FabricImage;
  const original = getOriginalDimensions(target);
  const currentScale = target.scaleY || 1;
  const currentCropY = target.cropY || 0;
  const currentHeight = target.height || original.height;

  const localPoint = getLocalPoint(
    transform,
    transform.originX,
    transform.originY,
    x,
    y,
  );

  const requestedVisualHeight = Math.max(MIN_SIZE, Math.abs(localPoint.y));

  // Bottom edge position in original image coords (stays fixed)
  const bottomEdgeInOriginal = currentCropY + currentHeight;

  // Maximum we can expand to the top (cropY can go to 0)
  const maxAvailableHeight = bottomEdgeInOriginal * currentScale;

  if (requestedVisualHeight <= maxAvailableHeight) {
    // Within bounds - adjust cropY and height (crops from top)
    const newHeightUnscaled = requestedVisualHeight / currentScale;
    const newCropY = bottomEdgeInOriginal - newHeightUnscaled;

    if (newCropY >= 0) {
      target.cropY = newCropY;
      target.height = newHeightUnscaled;
    } else {
      // Hit top boundary
      target.cropY = 0;
      target.height = bottomEdgeInOriginal;
    }
  } else {
    // Beyond bounds - scale uniformly
    target.cropY = 0;
    target.height = bottomEdgeInOriginal;
    const newScale = requestedVisualHeight / target.height;
    target.scaleX = newScale;
    target.scaleY = newScale;
    const currentVisualWidth = (target.width || original.width) * currentScale;
    target.width = currentVisualWidth / newScale;
  }

  target.setCoords();
  return true;
};

// Wrapped resize handlers with fixed anchor
const resizeFromRight = wrapWithFireEvent(
  RESIZING,
  wrapWithFixedAnchor(resizeFromRightHandler),
);

const resizeFromLeft = wrapWithFireEvent(
  RESIZING,
  wrapWithFixedAnchor(resizeFromLeftHandler),
);

const resizeFromBottom = wrapWithFireEvent(
  RESIZING,
  wrapWithFixedAnchor(resizeFromBottomHandler),
);

const resizeFromTop = wrapWithFireEvent(
  RESIZING,
  wrapWithFixedAnchor(resizeFromTopHandler),
);

/**
 * Handler for cropping from the left edge (ml control)
 * - Drag inward: increase cropX, decrease width (crop left side)
 * - Drag outward: decrease cropX until 0, then scale
 */
const cropFromLeftHandler: TransformActionHandler = (
  eventData: TPointerEvent,
  transform: Transform,
  x: number,
  y: number,
): boolean => {
  const target = transform.target as FabricImage;
  const localPoint = getLocalPoint(transform, 'right', 'center', x, y);

  const original = getOriginalDimensions(target);
  const currentCropX = target.cropX || 0;
  const currentWidth = target.width || 100;
  const currentScale = target.scaleX || 1;

  // Requested width based on mouse position (localPoint.x is negative from right origin)
  const requestedWidth = Math.max(MIN_SIZE, Math.abs(localPoint.x));

  // Current right edge position in original image coordinates
  const rightEdge = currentCropX + currentWidth;

  // Maximum possible width at current scale (if cropX goes to 0)
  const maxVisibleWidth = rightEdge * currentScale;

  if (requestedWidth <= maxVisibleWidth) {
    // Within bounds - adjust cropX and width
    const newWidthUnscaled = requestedWidth / currentScale;
    const newCropX = rightEdge - newWidthUnscaled;

    if (newCropX >= 0) {
      target.cropX = newCropX;
      target.width = newWidthUnscaled;
    } else {
      // Would go past left edge - clamp cropX to 0
      target.cropX = 0;
      target.width = rightEdge;
    }
  } else {
    // Beyond bounds - need to scale
    target.cropX = 0;
    target.width = rightEdge;
    const newScale = requestedWidth / target.width;
    target.scaleX = newScale;
    target.scaleY = newScale;
  }

  target.setCoords();
  return true;
};

/**
 * Handler for cropping from the bottom edge (mb control)
 */
const cropFromBottomHandler: TransformActionHandler = (
  eventData: TPointerEvent,
  transform: Transform,
  x: number,
  y: number,
): boolean => {
  const target = transform.target as FabricImage;
  const localPoint = getLocalPoint(transform, 'center', 'top', x, y);

  const original = getOriginalDimensions(target);
  const currentCropY = target.cropY || 0;
  const currentScale = target.scaleY || 1;

  const maxVisibleHeight = (original.height - currentCropY) * currentScale;
  const requestedHeight = Math.max(MIN_SIZE, localPoint.y);

  if (requestedHeight <= maxVisibleHeight) {
    target.height = requestedHeight / currentScale;
  } else {
    target.height = original.height - currentCropY;
    const newScale = requestedHeight / target.height;
    target.scaleX = newScale;
    target.scaleY = newScale;
  }

  target.setCoords();
  return true;
};

/**
 * Handler for cropping from the top edge (mt control)
 */
const cropFromTopHandler: TransformActionHandler = (
  eventData: TPointerEvent,
  transform: Transform,
  x: number,
  y: number,
): boolean => {
  const target = transform.target as FabricImage;
  const localPoint = getLocalPoint(transform, 'center', 'bottom', x, y);

  const original = getOriginalDimensions(target);
  const currentCropY = target.cropY || 0;
  const currentHeight = target.height || 100;
  const currentScale = target.scaleY || 1;

  const requestedHeight = Math.max(MIN_SIZE, Math.abs(localPoint.y));
  const bottomEdge = currentCropY + currentHeight;
  const maxVisibleHeight = bottomEdge * currentScale;

  if (requestedHeight <= maxVisibleHeight) {
    const newHeightUnscaled = requestedHeight / currentScale;
    const newCropY = bottomEdge - newHeightUnscaled;

    if (newCropY >= 0) {
      target.cropY = newCropY;
      target.height = newHeightUnscaled;
    } else {
      target.cropY = 0;
      target.height = bottomEdge;
    }
  } else {
    target.cropY = 0;
    target.height = bottomEdge;
    const newScale = requestedHeight / target.height;
    target.scaleX = newScale;
    target.scaleY = newScale;
  }

  target.setCoords();
  return true;
};

/**
 * Handler for cropping from corners (tl, tr, bl, br controls)
 * Handles both dimensions simultaneously
 */
const createCornerCropHandler = (
  xDirection: 'left' | 'right',
  yDirection: 'top' | 'bottom',
): TransformActionHandler => {
  const xHandler = xDirection === 'left' ? cropFromLeftHandler : cropFromRightHandler;
  const yHandler = yDirection === 'top' ? cropFromTopHandler : cropFromBottomHandler;

  return (
    eventData: TPointerEvent,
    transform: Transform,
    x: number,
    y: number,
  ): boolean => {
    // Apply both handlers
    const xChanged = xHandler(eventData, transform, x, y);
    const yChanged = yHandler(eventData, transform, x, y);
    return xChanged || yChanged;
  };
};

// Wrapped handlers with fixed anchor and fire event
const cropFromRight = wrapWithFireEvent(
  RESIZING,
  wrapWithFixedAnchor(cropFromRightHandler),
);

const cropFromLeft = wrapWithFireEvent(
  RESIZING,
  wrapWithFixedAnchor(cropFromLeftHandler),
);

const cropFromBottom = wrapWithFireEvent(
  RESIZING,
  wrapWithFixedAnchor(cropFromBottomHandler),
);

const cropFromTop = wrapWithFireEvent(
  RESIZING,
  wrapWithFixedAnchor(cropFromTopHandler),
);

const cropFromTopLeft = wrapWithFireEvent(
  RESIZING,
  wrapWithFixedAnchor(createCornerCropHandler('left', 'top')),
);

const cropFromTopRight = wrapWithFireEvent(
  RESIZING,
  wrapWithFixedAnchor(createCornerCropHandler('right', 'top')),
);

const cropFromBottomLeft = wrapWithFireEvent(
  RESIZING,
  wrapWithFixedAnchor(createCornerCropHandler('left', 'bottom')),
);

const cropFromBottomRight = wrapWithFireEvent(
  RESIZING,
  wrapWithFixedAnchor(createCornerCropHandler('right', 'bottom')),
);

/**
 * Creates Canva-like controls for FabricImage
 * - Side handles crop/resize visible area (Canva style)
 * - Corner handles scale uniformly
 * - Double-click enters crop mode for fine-tuning
 */
export const createImageCropControls = () => ({
  // Side controls - crop from each side
  ml: new Control({
    x: -0.5,
    y: 0,
    cursorStyleHandler: scaleSkewCursorStyleHandler,
    actionHandler: resizeFromLeft,
    actionName: RESIZING,
    render: renderHorizontalPillControl,
    sizeX: 6,
    sizeY: 20,
  }),

  mr: new Control({
    x: 0.5,
    y: 0,
    cursorStyleHandler: scaleSkewCursorStyleHandler,
    actionHandler: resizeFromRight,
    actionName: RESIZING,
    render: renderHorizontalPillControl,
    sizeX: 6,
    sizeY: 20,
  }),

  mb: new Control({
    x: 0,
    y: 0.5,
    cursorStyleHandler: scaleSkewCursorStyleHandler,
    actionHandler: resizeFromBottom,
    actionName: RESIZING,
    render: renderVerticalPillControl,
    sizeX: 20,
    sizeY: 6,
  }),

  mt: new Control({
    x: 0,
    y: -0.5,
    cursorStyleHandler: scaleSkewCursorStyleHandler,
    actionHandler: resizeFromTop,
    actionName: RESIZING,
    render: renderVerticalPillControl,
    sizeX: 20,
    sizeY: 6,
  }),

  // Corner controls - uniform scaling (like Canva)
  tl: new Control({
    x: -0.5,
    y: -0.5,
    cursorStyleHandler: scaleCursorStyleHandler,
    actionHandler: scalingEqually,
  }),

  tr: new Control({
    x: 0.5,
    y: -0.5,
    cursorStyleHandler: scaleCursorStyleHandler,
    actionHandler: scalingEqually,
  }),

  bl: new Control({
    x: -0.5,
    y: 0.5,
    cursorStyleHandler: scaleCursorStyleHandler,
    actionHandler: scalingEqually,
  }),

  br: new Control({
    x: 0.5,
    y: 0.5,
    cursorStyleHandler: scaleCursorStyleHandler,
    actionHandler: scalingEqually,
  }),

  mtr: new Control({
    x: 0,
    y: -0.5,
    actionHandler: rotationWithSnapping,
    cursorStyleHandler: rotationStyleHandler,
    offsetY: -40,
    withConnection: true,
    actionName: ROTATE,
  }),
});

/**
 * Creates crop mode controls for FabricImage (used in crop mode after double-click)
 * - Side handles crop/uncrop single axis
 * - Corner handles crop/uncrop both axes
 */
export const createImageCropModeControls = () => ({
  ml: new Control({
    x: -0.5,
    y: 0,
    cursorStyleHandler: scaleSkewCursorStyleHandler,
    actionHandler: cropFromLeft,
    actionName: RESIZING,
    render: renderHorizontalPillControl,
    sizeX: 6,
    sizeY: 20,
  }),

  mr: new Control({
    x: 0.5,
    y: 0,
    cursorStyleHandler: scaleSkewCursorStyleHandler,
    actionHandler: cropFromRight,
    actionName: RESIZING,
    render: renderHorizontalPillControl,
    sizeX: 6,
    sizeY: 20,
  }),

  mb: new Control({
    x: 0,
    y: 0.5,
    cursorStyleHandler: scaleSkewCursorStyleHandler,
    actionHandler: cropFromBottom,
    actionName: RESIZING,
    render: renderVerticalPillControl,
    sizeX: 20,
    sizeY: 6,
  }),

  mt: new Control({
    x: 0,
    y: -0.5,
    cursorStyleHandler: scaleSkewCursorStyleHandler,
    actionHandler: cropFromTop,
    actionName: RESIZING,
    render: renderVerticalPillControl,
    sizeX: 20,
    sizeY: 6,
  }),

  // No corner controls in crop mode - or could add corner crop handlers
  // No rotation in crop mode
});

// Export individual handlers for custom use
export {
  cropFromRight,
  cropFromLeft,
  cropFromTop,
  cropFromBottom,
  cropFromTopLeft,
  cropFromTopRight,
  cropFromBottomLeft,
  cropFromBottomRight,
};
