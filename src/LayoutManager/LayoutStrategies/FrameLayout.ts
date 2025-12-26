import { Point } from '../../Point';
import type { FabricObject } from '../../shapes/Object/FabricObject';
import { classRegistry } from '../../ClassRegistry';
import { LayoutStrategy } from './LayoutStrategy';
import type { LayoutStrategyResult, StrictLayoutContext } from '../types';
import { LAYOUT_TYPE_INITIALIZATION } from '../constants';

/**
 * FrameLayout is a layout strategy that maintains fixed dimensions
 * regardless of the content inside the group.
 *
 * This is essential for Frame objects where:
 * - The frame size should never change when images are added/removed
 * - Content is clipped to the frame boundaries
 * - The frame acts as a container with fixed dimensions
 */
export class FrameLayout extends LayoutStrategy {
  static readonly type = 'frame-layout';

  /**
   * Override to prevent layout recalculation on content changes.
   * Only perform layout during initialization or imperative calls.
   */
  shouldPerformLayout({ type }: StrictLayoutContext): boolean {
    // Only perform layout during initialization
    // After that, the frame maintains its fixed size
    return type === LAYOUT_TYPE_INITIALIZATION;
  }

  /**
   * Calculate the bounding box for frame objects.
   * Returns the fixed frame dimensions instead of calculating from contents.
   */
  calcBoundingBox(
    objects: FabricObject[],
    context: StrictLayoutContext
  ): LayoutStrategyResult | undefined {
    const { type, target } = context;

    // Get fixed dimensions from frame properties
    const frameWidth = (target as any).frameWidth ?? target.width ?? 200;
    const frameHeight = (target as any).frameHeight ?? target.height ?? 200;

    const size = new Point(frameWidth, frameHeight);

    if (type === LAYOUT_TYPE_INITIALIZATION) {
      // During initialization, use the frame's position or calculate center
      const center = new Point(0, 0);

      return {
        center,
        size,
        relativeCorrection: new Point(0, 0),
      };
    }

    // For any other layout triggers, return the fixed size
    // This shouldn't normally be called due to shouldPerformLayout override
    const center = target.getRelativeCenterPoint();
    return {
      center,
      size,
    };
  }

  /**
   * Override to always return fixed frame dimensions during initialization.
   */
  getInitialSize(
    context: StrictLayoutContext,
    result: Pick<LayoutStrategyResult, 'center' | 'size'>
  ): Point {
    const { target } = context;
    const frameWidth = (target as any).frameWidth ?? target.width ?? 200;
    const frameHeight = (target as any).frameHeight ?? target.height ?? 200;
    return new Point(frameWidth, frameHeight);
  }
}

classRegistry.setClass(FrameLayout);
