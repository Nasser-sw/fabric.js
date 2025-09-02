import type { TransformActionHandler } from '../EventTypeDefs';
import { BOTTOM, CENTER, RESIZING, TOP } from '../constants';
import { resolveOrigin } from '../util/misc/resolveOrigin';
import { getLocalPoint, isTransformCentered } from './util';
import { wrapWithFireEvent } from './wrapWithFireEvent';
import { wrapWithFixedAnchor } from './wrapWithFixedAnchor';

/**
 * Action handler to change object's height
 * Needs to be wrapped with `wrapWithFixedAnchor` to be effective
 * @param {Event} eventData javascript event that is doing the transform
 * @param {Object} transform javascript object containing a series of information around the current transform
 * @param {number} x current mouse x position, canvas normalized
 * @param {number} y current mouse y position, canvas normalized
 * @return {Boolean} true if some change happened
 */
export const changeObjectHeight: TransformActionHandler = (
  eventData,
  transform,
  x,
  y,
) => {
  const localPoint = getLocalPoint(
    transform,
    transform.originX,
    transform.originY,
    x,
    y,
  );
  //  make sure the control changes height ONLY from it's side of target
  if (
    resolveOrigin(transform.originY) === resolveOrigin(CENTER) ||
    (resolveOrigin(transform.originY) === resolveOrigin(BOTTOM) &&
      localPoint.y < 0) ||
    (resolveOrigin(transform.originY) === resolveOrigin(TOP) &&
      localPoint.y > 0)
  ) {
    const { target } = transform,
      strokePadding =
        target.strokeWidth / (target.strokeUniform ? target.scaleY : 1),
      multiplier = isTransformCentered(transform) ? 2 : 1,
      oldHeight = target.height,
      newHeight =
        Math.abs((localPoint.y * multiplier) / target.scaleY) - strokePadding;
    target.set('height', Math.max(newHeight, 1));
    //  check against actual target height in case `newHeight` was rejected
    return oldHeight !== target.height;
  }
  return false;
};

export const changeHeight = wrapWithFireEvent(
  RESIZING,
  wrapWithFixedAnchor(changeObjectHeight),
);