import type { TClassProperties, TOptions, Abortable, TCrossOrigin } from '../typedefs';
import type { FabricObject } from './Object/FabricObject';
import type { GroupProps, SerializedGroupProps } from './Group';
import type { TPointerEvent, Transform, TransformActionHandler } from '../EventTypeDefs';
import { Group } from './Group';
import { Rect } from './Rect';
import { Circle } from './Circle';
import { Path } from './Path';
import { FabricImage } from './Image';
import { classRegistry } from '../ClassRegistry';
import { LayoutManager } from '../LayoutManager/LayoutManager';
import { FrameLayout } from '../LayoutManager/LayoutStrategies/FrameLayout';
import { enlivenObjects, enlivenObjectEnlivables } from '../util/misc/objectEnlive';
import { Control } from '../controls/Control';
import { getLocalPoint } from '../controls/util';
import { wrapWithFireEvent } from '../controls/wrapWithFireEvent';
import { wrapWithFixedAnchor } from '../controls/wrapWithFixedAnchor';
import { RESIZING } from '../constants';

/**
 * Frame shape types supported out of the box
 */
export type FrameShapeType = 'rect' | 'circle' | 'rounded-rect' | 'custom';

/**
 * Frame metadata for persistence and state management
 */
export interface FrameMeta {
  /** Aspect ratio label (e.g., '16:9', '1:1', '4:5') */
  aspect?: string;
  /** Content scale factor for cover scaling */
  contentScale?: number;
  /** X offset of content within frame */
  contentOffsetX?: number;
  /** Y offset of content within frame */
  contentOffsetY?: number;
  /** Source URL of the current image */
  imageSrc?: string;
  /** Original image dimensions */
  originalWidth?: number;
  /** Original image dimensions */
  originalHeight?: number;
}

/**
 * Frame-specific properties
 */
export interface FrameOwnProps {
  /** Fixed width of the frame */
  frameWidth: number;
  /** Fixed height of the frame */
  frameHeight: number;
  /** Shape type for the clip mask */
  frameShape: FrameShapeType;
  /** Border radius for rounded-rect shape */
  frameBorderRadius: number;
  /** Custom SVG path for custom shape */
  frameCustomPath?: string;
  /** Frame metadata for content positioning */
  frameMeta: FrameMeta;
  /** Whether the frame is in edit mode (content can be repositioned) */
  isEditMode: boolean;
  /** Placeholder text shown when frame is empty */
  placeholderText: string;
  /** Placeholder background color */
  placeholderColor: string;
}

export interface SerializedFrameProps extends SerializedGroupProps, FrameOwnProps {}

export interface FrameProps extends GroupProps, FrameOwnProps {}

export const frameDefaultValues: Partial<TClassProperties<Frame>> = {
  frameWidth: 200,
  frameHeight: 200,
  frameShape: 'rect',
  frameBorderRadius: 0,
  isEditMode: false,
  placeholderText: 'Drop image here',
  placeholderColor: '#d0d0d0',
  frameMeta: {
    contentScale: 1,
    contentOffsetX: 0,
    contentOffsetY: 0,
  },
};

/**
 * Frame class - A Canva-like frame container for images
 *
 * Features:
 * - Fixed dimensions that don't change when content is added/removed
 * - Multiple shape types (rect, circle, rounded-rect, custom SVG path)
 * - Cover scaling: images fill the frame completely, overflow is clipped
 * - Double-click edit mode: reposition/zoom content within frame
 * - Drag & drop support for replacing images
 * - Full serialization/deserialization support
 *
 * @example
 * ```ts
 * // Create a rectangular frame
 * const frame = new Frame([], {
 *   frameWidth: 300,
 *   frameHeight: 200,
 *   frameShape: 'rect',
 *   left: 100,
 *   top: 100,
 * });
 *
 * // Add image with cover scaling
 * await frame.setImage('https://example.com/image.jpg');
 *
 * canvas.add(frame);
 * ```
 */
export class Frame extends Group {
  static type = 'Frame';

  declare frameWidth: number;
  declare frameHeight: number;
  declare frameShape: FrameShapeType;
  declare frameBorderRadius: number;
  declare frameCustomPath?: string;
  declare frameMeta: FrameMeta;
  declare isEditMode: boolean;
  declare placeholderText: string;
  declare placeholderColor: string;

  /**
   * Reference to the content image
   * @private
   */
  private _contentImage: FabricImage | null = null;

  /**
   * Reference to the placeholder object
   * @private
   */
  private _placeholder: FabricObject | null = null;

  /**
   * Stored objectCaching value before edit mode
   * @private
   */
  private _editModeObjectCaching?: boolean;

  static ownDefaults = frameDefaultValues;

  static getDefaults(): Record<string, any> {
    return {
      ...super.getDefaults(),
      ...Frame.ownDefaults,
    };
  }

  /**
   * Constructor
   * @param objects - Initial objects (typically empty for frames)
   * @param options - Frame configuration options
   */
  constructor(
    objects: FabricObject[] = [],
    options: Partial<FrameProps> = {}
  ) {
    // Set up the frame layout manager before calling super
    const frameLayoutManager = new LayoutManager(new FrameLayout());

    super(objects, {
      ...options,
      layoutManager: frameLayoutManager,
    });

    // Apply defaults
    Object.assign(this, Frame.ownDefaults);

    // Apply user options
    this.setOptions(options);

    // Ensure frameMeta is properly initialized with defaults
    const defaultMeta = frameDefaultValues.frameMeta || {};
    this.frameMeta = {
      contentScale: defaultMeta.contentScale ?? 1,
      contentOffsetX: defaultMeta.contentOffsetX ?? 0,
      contentOffsetY: defaultMeta.contentOffsetY ?? 0,
      ...options.frameMeta,
    };

    // Set fixed dimensions
    this.set({
      width: this.frameWidth,
      height: this.frameHeight,
    });

    // Create clip path based on shape
    this._updateClipPath();

    // Create placeholder if no content
    if (objects.length === 0) {
      this._createPlaceholder();
    }

    // Set up custom resize controls (instead of scale controls)
    this._setupResizeControls();
  }

  /**
   * Sets up custom controls that resize instead of scale
   * This is the key to Canva-like behavior - corners resize the frame dimensions
   * instead of scaling the entire group (which would stretch the image)
   * @private
   */
  private _setupResizeControls(): void {
    // Helper to change width (like changeObjectWidth but for frames)
    // Note: wrapWithFixedAnchor sets origin to opposite corner, so localPoint.x IS the new width
    const changeFrameWidth: TransformActionHandler = (
      eventData,
      transform,
      x,
      y
    ): boolean => {
      const target = transform.target as Frame;
      const localPoint = getLocalPoint(
        transform,
        transform.originX,
        transform.originY,
        x,
        y
      );

      const oldWidth = target.frameWidth;
      // localPoint.x is distance from anchor (opposite side) to mouse = new width
      const newWidth = Math.max(20, Math.abs(localPoint.x));

      if (Math.abs(oldWidth - newWidth) < 1) return false;

      target.frameWidth = newWidth;
      target.width = newWidth;
      target._updateClipPath();
      target._adjustContentAfterResize();

      return true;
    };

    // Helper to change height
    const changeFrameHeight: TransformActionHandler = (
      eventData,
      transform,
      x,
      y
    ): boolean => {
      const target = transform.target as Frame;
      const localPoint = getLocalPoint(
        transform,
        transform.originX,
        transform.originY,
        x,
        y
      );

      const oldHeight = target.frameHeight;
      const newHeight = Math.max(20, Math.abs(localPoint.y));

      if (Math.abs(oldHeight - newHeight) < 1) return false;

      target.frameHeight = newHeight;
      target.height = newHeight;
      target._updateClipPath();
      target._adjustContentAfterResize();

      return true;
    };

    // Helper to change both width and height (corners)
    const changeFrameSize: TransformActionHandler = (
      eventData,
      transform,
      x,
      y
    ): boolean => {
      const target = transform.target as Frame;
      const localPoint = getLocalPoint(
        transform,
        transform.originX,
        transform.originY,
        x,
        y
      );

      const oldWidth = target.frameWidth;
      const oldHeight = target.frameHeight;
      const newWidth = Math.max(20, Math.abs(localPoint.x));
      const newHeight = Math.max(20, Math.abs(localPoint.y));

      if (Math.abs(oldWidth - newWidth) < 1 && Math.abs(oldHeight - newHeight) < 1) return false;

      target.frameWidth = newWidth;
      target.frameHeight = newHeight;
      target.width = newWidth;
      target.height = newHeight;
      target._updateClipPath();
      target._adjustContentAfterResize();

      return true;
    };

    // Create wrapped handlers
    const resizeFromCorner = wrapWithFireEvent(
      RESIZING,
      wrapWithFixedAnchor(changeFrameSize)
    );

    const resizeX = wrapWithFireEvent(
      RESIZING,
      wrapWithFixedAnchor(changeFrameWidth)
    );

    const resizeY = wrapWithFireEvent(
      RESIZING,
      wrapWithFixedAnchor(changeFrameHeight)
    );

    // Guard: ensure controls exist
    if (!this.controls) {
      console.warn('Frame: controls not initialized yet');
      return;
    }

    // Override corner controls - use resize instead of scale
    const cornerControls = ['tl', 'tr', 'bl', 'br'] as const;
    cornerControls.forEach((corner) => {
      const existing = this.controls[corner];
      if (existing) {
        this.controls[corner] = new Control({
          x: existing.x,
          y: existing.y,
          cursorStyleHandler: existing.cursorStyleHandler,
          actionHandler: resizeFromCorner,
          actionName: 'resizing',
        });
      }
    });

    // Override side controls for horizontal resize
    const horizontalControls = ['ml', 'mr'] as const;
    horizontalControls.forEach((corner) => {
      const existing = this.controls[corner];
      if (existing) {
        this.controls[corner] = new Control({
          x: existing.x,
          y: existing.y,
          cursorStyleHandler: existing.cursorStyleHandler,
          actionHandler: resizeX,
          actionName: 'resizing',
          render: existing.render, // Keep the global pill renderer
          sizeX: existing.sizeX,
          sizeY: existing.sizeY,
        });
      }
    });

    // Override side controls for vertical resize
    const verticalControls = ['mt', 'mb'] as const;
    verticalControls.forEach((corner) => {
      const existing = this.controls[corner];
      if (existing) {
        this.controls[corner] = new Control({
          x: existing.x,
          y: existing.y,
          cursorStyleHandler: existing.cursorStyleHandler,
          actionHandler: resizeY,
          actionName: 'resizing',
          render: existing.render, // Keep the global pill renderer
          sizeX: existing.sizeX,
          sizeY: existing.sizeY,
        });
      }
    });
  }

  /**
   * Adjusts content after a resize operation (called from set override)
   * @private
   */
  private _adjustContentAfterResize(): void {
    // Update placeholder if present (simple rect)
    if (this._placeholder) {
      this._placeholder.set({
        width: this.frameWidth,
        height: this.frameHeight,
      });
    }

    // Adjust content image (Canva-like behavior)
    if (this._contentImage) {
      const img = this._contentImage;
      const originalWidth = this.frameMeta.originalWidth ?? img.width ?? 100;
      const originalHeight = this.frameMeta.originalHeight ?? img.height ?? 100;

      // Current image scale and position - preserve user's position
      let currentScale = img.scaleX ?? 1;
      let imgCenterX = img.left ?? 0;
      let imgCenterY = img.top ?? 0;

      // Check if current scale still covers the frame
      const minScaleForCover = this._calculateCoverScale(originalWidth, originalHeight);

      if (currentScale < minScaleForCover) {
        // Image is too small to cover frame - scale up proportionally
        // But try to keep the same visual center point
        const scaleRatio = minScaleForCover / currentScale;

        // Scale position proportionally to maintain visual anchor
        imgCenterX = imgCenterX * scaleRatio;
        imgCenterY = imgCenterY * scaleRatio;
        currentScale = minScaleForCover;

        img.set({
          scaleX: currentScale,
          scaleY: currentScale,
        });

        this.frameMeta = {
          ...this.frameMeta,
          contentScale: currentScale,
        };
      }

      // Now constrain position only if needed to prevent empty space
      const scaledImgHalfW = (originalWidth * currentScale) / 2;
      const scaledImgHalfH = (originalHeight * currentScale) / 2;
      const frameHalfW = this.frameWidth / 2;
      const frameHalfH = this.frameHeight / 2;

      // Calculate how much the image can move while still covering the frame
      const maxOffsetX = Math.max(0, scaledImgHalfW - frameHalfW);
      const maxOffsetY = Math.max(0, scaledImgHalfH - frameHalfH);

      // Only constrain if position would show empty space
      const needsConstraintX = Math.abs(imgCenterX) > maxOffsetX;
      const needsConstraintY = Math.abs(imgCenterY) > maxOffsetY;

      if (needsConstraintX) {
        imgCenterX = Math.max(-maxOffsetX, Math.min(maxOffsetX, imgCenterX));
      }
      if (needsConstraintY) {
        imgCenterY = Math.max(-maxOffsetY, Math.min(maxOffsetY, imgCenterY));
      }

      if (needsConstraintX || needsConstraintY) {
        img.set({
          left: imgCenterX,
          top: imgCenterY,
        });

        this.frameMeta = {
          ...this.frameMeta,
          contentOffsetX: imgCenterX,
          contentOffsetY: imgCenterY,
        };
      }

      img.setCoords();
    }

    this.setCoords();
  }

  /**
   * Updates the clip path based on the current frame shape
   * @private
   */
  private _updateClipPath(): void {
    let clipPath: FabricObject;

    switch (this.frameShape) {
      case 'circle': {
        const radius = Math.min(this.frameWidth, this.frameHeight) / 2;
        clipPath = new Circle({
          radius,
          originX: 'center',
          originY: 'center',
          left: 0,
          top: 0,
        });
        break;
      }

      case 'rounded-rect': {
        clipPath = new Rect({
          width: this.frameWidth,
          height: this.frameHeight,
          rx: this.frameBorderRadius,
          ry: this.frameBorderRadius,
          originX: 'center',
          originY: 'center',
          left: 0,
          top: 0,
        });
        break;
      }

      case 'custom': {
        if (this.frameCustomPath) {
          clipPath = new Path(this.frameCustomPath, {
            originX: 'center',
            originY: 'center',
            left: 0,
            top: 0,
          });
          // Scale custom path to fit frame
          const pathBounds = clipPath.getBoundingRect();
          const scaleX = this.frameWidth / pathBounds.width;
          const scaleY = this.frameHeight / pathBounds.height;
          clipPath.set({ scaleX, scaleY });
        } else {
          // Fallback to rect if no custom path
          clipPath = new Rect({
            width: this.frameWidth,
            height: this.frameHeight,
            originX: 'center',
            originY: 'center',
            left: 0,
            top: 0,
          });
        }
        break;
      }

      case 'rect':
      default: {
        clipPath = new Rect({
          width: this.frameWidth,
          height: this.frameHeight,
          originX: 'center',
          originY: 'center',
          left: 0,
          top: 0,
        });
        break;
      }
    }

    this.clipPath = clipPath;
    this.set('dirty', true);
  }

  /**
   * Creates a placeholder element for empty frames
   * Shows a colored rectangle - users can customize via placeholderColor
   * @private
   */
  private _createPlaceholder(): void {
    // Remove existing placeholder if any
    if (this._placeholder) {
      super.remove(this._placeholder);
      this._placeholder = null;
    }

    // Create placeholder background
    const placeholder = new Rect({
      width: this.frameWidth,
      height: this.frameHeight,
      fill: this.placeholderColor,
      originX: 'center',
      originY: 'center',
      left: 0,
      top: 0,
      selectable: false,
      evented: false,
    });

    this._placeholder = placeholder;
    super.add(placeholder);

    // Ensure dimensions remain fixed
    this._restoreFixedDimensions();
  }

  /**
   * Removes the placeholder element
   * @private
   */
  private _removePlaceholder(): void {
    if (this._placeholder) {
      super.remove(this._placeholder);
      this._placeholder = null;
    }
  }

  /**
   * Restores the fixed frame dimensions
   * @private
   */
  private _restoreFixedDimensions(): void {
    this.set({
      width: this.frameWidth,
      height: this.frameHeight,
    });
  }

  /**
   * Sets an image in the frame with cover scaling
   *
   * @param src - Image source URL
   * @param options - Optional loading options
   * @returns Promise that resolves when the image is loaded and set
   *
   * @example
   * ```ts
   * await frame.setImage('https://example.com/photo.jpg');
   * canvas.renderAll();
   * ```
   */
  async setImage(
    src: string,
    options: { crossOrigin?: TCrossOrigin; signal?: AbortSignal } = {}
  ): Promise<void> {
    const { crossOrigin = 'anonymous', signal } = options;

    // Load the image
    const image = await FabricImage.fromURL(src, { crossOrigin, signal });

    // Get original dimensions
    const originalWidth = image.width ?? 100;
    const originalHeight = image.height ?? 100;

    // Calculate cover scale
    const scale = this._calculateCoverScale(originalWidth, originalHeight);

    // Configure image for frame
    image.set({
      scaleX: scale,
      scaleY: scale,
      originX: 'center',
      originY: 'center',
      left: 0,
      top: 0,
      selectable: false,
      evented: false,
    });

    // Remove existing content
    this._clearContent();

    // Add new image
    this._contentImage = image;
    super.add(image);

    // Force re-center the image after adding (layout might have moved it)
    this._contentImage.set({
      left: 0,
      top: 0,
    });

    // Update metadata
    this.frameMeta = {
      ...this.frameMeta,
      contentScale: scale,
      contentOffsetX: 0,
      contentOffsetY: 0,
      imageSrc: src,
      originalWidth,
      originalHeight,
    };

    // Restore dimensions (in case Group recalculated them)
    this._restoreFixedDimensions();

    // Force recalculation of coordinates
    this.setCoords();
    this._contentImage.setCoords();

    this.set('dirty', true);
  }

  /**
   * Sets an image from an existing FabricImage object
   *
   * @param image - FabricImage instance
   */
  setImageObject(image: FabricImage): void {
    const originalWidth = image.width ?? 100;
    const originalHeight = image.height ?? 100;

    // Calculate cover scale
    const scale = this._calculateCoverScale(originalWidth, originalHeight);

    // Configure image for frame
    image.set({
      scaleX: scale,
      scaleY: scale,
      originX: 'center',
      originY: 'center',
      left: 0,
      top: 0,
      selectable: false,
      evented: false,
    });

    // Remove existing content
    this._clearContent();

    // Add new image
    this._contentImage = image;
    super.add(image);

    // Update metadata
    this.frameMeta = {
      ...this.frameMeta,
      contentScale: scale,
      contentOffsetX: 0,
      contentOffsetY: 0,
      imageSrc: image.getSrc(),
      originalWidth,
      originalHeight,
    };

    // Restore dimensions
    this._restoreFixedDimensions();

    this.set('dirty', true);
  }

  /**
   * Calculates the cover scale factor for an image
   * Cover scaling ensures the image fills the frame completely
   *
   * @param imageWidth - Original image width
   * @param imageHeight - Original image height
   * @returns Scale factor to apply
   * @private
   */
  private _calculateCoverScale(imageWidth: number, imageHeight: number): number {
    const scaleX = this.frameWidth / imageWidth;
    const scaleY = this.frameHeight / imageHeight;
    return Math.max(scaleX, scaleY);
  }

  /**
   * Clears all content from the frame
   * @private
   */
  private _clearContent(): void {
    // Remove placeholder
    this._removePlaceholder();

    // Remove content image
    if (this._contentImage) {
      super.remove(this._contentImage);
      this._contentImage = null;
    }

    // Clear any other objects
    const objects = this.getObjects();
    objects.forEach((obj) => super.remove(obj));
  }

  /**
   * Clears the frame content and shows placeholder
   */
  clearContent(): void {
    this._clearContent();
    this._createPlaceholder();

    // Reset metadata
    this.frameMeta = {
      contentScale: 1,
      contentOffsetX: 0,
      contentOffsetY: 0,
    };

    this.set('dirty', true);
  }

  /**
   * Checks if the frame has image content
   */
  hasContent(): boolean {
    return this._contentImage !== null;
  }

  /**
   * Gets the current content image
   */
  getContentImage(): FabricImage | null {
    return this._contentImage;
  }

  /**
   * Enters edit mode for repositioning content within the frame
   * In edit mode, the content image can be dragged and scaled
   */
  enterEditMode(): void {
    if (!this._contentImage || this.isEditMode) {
      return;
    }

    this.isEditMode = true;

    // Disable caching during edit mode - otherwise the cache canvas
    // clips content to the frame bounds, preventing us from seeing
    // the full image outside the frame
    this._editModeObjectCaching = this.objectCaching;
    this.objectCaching = false;

    // Enable sub-target interaction so clicks go through to content
    this.subTargetCheck = true;
    this.interactive = true;

    // Calculate minimum scale to cover frame
    const originalWidth = this.frameMeta.originalWidth ?? this._contentImage.width ?? 100;
    const originalHeight = this.frameMeta.originalHeight ?? this._contentImage.height ?? 100;
    const minScale = this._calculateCoverScale(originalWidth, originalHeight);

    // Make content image interactive with scale constraint
    this._contentImage.set({
      selectable: true,
      evented: true,
      hasControls: true,
      hasBorders: true,
      minScaleLimit: minScale,
      lockScalingFlip: true,
    });

    // Store clip path but keep rendering it for the overlay effect
    if (this.clipPath) {
      this._editModeClipPath = this.clipPath as FabricObject;
      this.clipPath = undefined;
    }


    // Add constraint handlers for moving/scaling
    this._setupEditModeConstraints();

    this.set('dirty', true);

    // Select the content image on the canvas
    if (this.canvas) {
      this.canvas.setActiveObject(this._contentImage);
      this.canvas.renderAll();
    }

    // Fire custom event
    (this as any).fire('frame:editmode:enter', { target: this });
  }

  /**
   * Bound constraint handler references for cleanup
   * @private
   */
  private _boundConstrainMove?: (e: any) => void;
  private _boundConstrainScale?: (e: any) => void;

  /**
   * Sets up constraints for edit mode - prevents gaps
   * @private
   */
  private _setupEditModeConstraints(): void {
    if (!this._contentImage || !this.canvas) return;

    const frame = this;
    const img = this._contentImage;

    // Constrain movement to prevent gaps
    this._boundConstrainMove = (e: any) => {
      if (e.target !== img || !frame.isEditMode) return;

      const originalWidth = frame.frameMeta.originalWidth ?? img.width ?? 100;
      const originalHeight = frame.frameMeta.originalHeight ?? img.height ?? 100;
      const currentScale = img.scaleX ?? 1;

      const scaledImgHalfW = (originalWidth * currentScale) / 2;
      const scaledImgHalfH = (originalHeight * currentScale) / 2;
      const frameHalfW = frame.frameWidth / 2;
      const frameHalfH = frame.frameHeight / 2;

      const maxOffsetX = Math.max(0, scaledImgHalfW - frameHalfW);
      const maxOffsetY = Math.max(0, scaledImgHalfH - frameHalfH);

      let left = img.left ?? 0;
      let top = img.top ?? 0;

      // Constrain position
      left = Math.max(-maxOffsetX, Math.min(maxOffsetX, left));
      top = Math.max(-maxOffsetY, Math.min(maxOffsetY, top));

      img.set({ left, top });
    };

    // Constrain scaling to prevent gaps
    this._boundConstrainScale = (e: any) => {
      if (e.target !== img || !frame.isEditMode) return;

      const originalWidth = frame.frameMeta.originalWidth ?? img.width ?? 100;
      const originalHeight = frame.frameMeta.originalHeight ?? img.height ?? 100;
      const minScale = frame._calculateCoverScale(originalWidth, originalHeight);

      let scaleX = img.scaleX ?? 1;
      let scaleY = img.scaleY ?? 1;

      // Ensure uniform scaling and minimum scale
      const scale = Math.max(minScale, Math.max(scaleX, scaleY));
      img.set({ scaleX: scale, scaleY: scale });

      // Also constrain position after scale
      frame._boundConstrainMove?.(e);
    };

    this.canvas.on('object:moving', this._boundConstrainMove);
    this.canvas.on('object:scaling', this._boundConstrainScale);
  }

  /**
   * Removes edit mode constraint handlers
   * @private
   */
  private _removeEditModeConstraints(): void {
    if (!this.canvas) return;

    if (this._boundConstrainMove) {
      this.canvas.off('object:moving', this._boundConstrainMove);
      this._boundConstrainMove = undefined;
    }
    if (this._boundConstrainScale) {
      this.canvas.off('object:scaling', this._boundConstrainScale);
      this._boundConstrainScale = undefined;
    }
  }

  /**
   * Stored clip path before edit mode
   * @private
   */
  private _editModeClipPath?: FabricObject;

  /**
   * Custom render to show edit mode overlay
   * @override
   */
  render(ctx: CanvasRenderingContext2D): void {
    super.render(ctx);

    // Draw edit mode overlay if in edit mode
    if (this.isEditMode && this._editModeClipPath) {
      this._renderEditModeOverlay(ctx);
    }
  }

  /**
   * Renders the edit mode overlay - dims area outside frame, shows frame border
   * @private
   */
  private _renderEditModeOverlay(ctx: CanvasRenderingContext2D): void {
    ctx.save();

    // Apply the group's transform
    const m = this.calcTransformMatrix();
    ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);

    // Draw semi-transparent overlay on the OUTSIDE of the frame
    // We do this by drawing a large rect and cutting out the frame shape
    ctx.beginPath();

    // Large outer rectangle (covers the whole image area)
    const padding = 2000; // Large enough to cover any overflow
    ctx.rect(-padding, -padding, padding * 2, padding * 2);

    // Cut out the frame shape (counter-clockwise to create hole)
    if (this.frameShape === 'circle') {
      const radius = Math.min(this.frameWidth, this.frameHeight) / 2;
      ctx.moveTo(radius, 0);
      ctx.arc(0, 0, radius, 0, Math.PI * 2, true);
    } else if (this.frameShape === 'rounded-rect') {
      const w = this.frameWidth / 2;
      const h = this.frameHeight / 2;
      const r = Math.min(this.frameBorderRadius, w, h);
      ctx.moveTo(w, h - r);
      ctx.arcTo(w, -h, w - r, -h, r);
      ctx.arcTo(-w, -h, -w, -h + r, r);
      ctx.arcTo(-w, h, -w + r, h, r);
      ctx.arcTo(w, h, w, h - r, r);
      ctx.closePath();
    } else {
      // Rectangle
      const w = this.frameWidth / 2;
      const h = this.frameHeight / 2;
      ctx.moveTo(w, -h);
      ctx.lineTo(-w, -h);
      ctx.lineTo(-w, h);
      ctx.lineTo(w, h);
      ctx.closePath();
    }

    // Fill with semi-transparent dark overlay
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fill('evenodd');

    // Draw frame border
    ctx.beginPath();
    if (this.frameShape === 'circle') {
      const radius = Math.min(this.frameWidth, this.frameHeight) / 2;
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
    } else if (this.frameShape === 'rounded-rect') {
      const w = this.frameWidth / 2;
      const h = this.frameHeight / 2;
      const r = Math.min(this.frameBorderRadius, w, h);
      ctx.moveTo(w - r, -h);
      ctx.arcTo(w, -h, w, -h + r, r);
      ctx.arcTo(w, h, w - r, h, r);
      ctx.arcTo(-w, h, -w, h - r, r);
      ctx.arcTo(-w, -h, -w + r, -h, r);
      ctx.closePath();
    } else {
      const w = this.frameWidth / 2;
      const h = this.frameHeight / 2;
      ctx.rect(-w, -h, this.frameWidth, this.frameHeight);
    }
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw subtle dashed line for frame boundary
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = 'rgba(0, 150, 255, 0.8)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.restore();
  }

  /**
   * Exits edit mode and saves the content position
   */
  exitEditMode(): void {
    if (!this._contentImage || !this.isEditMode) {
      return;
    }

    this.isEditMode = false;

    // Remove constraint handlers
    this._removeEditModeConstraints();

    // Disable sub-target interaction
    this.subTargetCheck = false;
    this.interactive = false;

    // Get the current position of the content
    const contentLeft = this._contentImage.left ?? 0;
    const contentTop = this._contentImage.top ?? 0;
    const contentScaleX = this._contentImage.scaleX ?? 1;
    const contentScaleY = this._contentImage.scaleY ?? 1;

    // Constrain position so image always covers the frame
    const originalWidth = this.frameMeta.originalWidth ?? this._contentImage.width ?? 100;
    const originalHeight = this.frameMeta.originalHeight ?? this._contentImage.height ?? 100;
    const currentScale = Math.max(contentScaleX, contentScaleY);
    const scaledImgHalfW = (originalWidth * currentScale) / 2;
    const scaledImgHalfH = (originalHeight * currentScale) / 2;
    const frameHalfW = this.frameWidth / 2;
    const frameHalfH = this.frameHeight / 2;

    // Ensure image covers frame (constrain position)
    const maxOffsetX = Math.max(0, scaledImgHalfW - frameHalfW);
    const maxOffsetY = Math.max(0, scaledImgHalfH - frameHalfH);
    const constrainedLeft = Math.max(-maxOffsetX, Math.min(maxOffsetX, contentLeft));
    const constrainedTop = Math.max(-maxOffsetY, Math.min(maxOffsetY, contentTop));

    // Apply constrained position
    this._contentImage.set({
      left: constrainedLeft,
      top: constrainedTop,
    });

    // Update metadata with new offsets and scale
    this.frameMeta = {
      ...this.frameMeta,
      contentOffsetX: constrainedLeft,
      contentOffsetY: constrainedTop,
      contentScale: currentScale,
    };

    // Make content non-interactive again
    this._contentImage.set({
      selectable: false,
      evented: false,
      hasControls: false,
      hasBorders: false,
    });

    // Restore clip path
    if (this._editModeClipPath) {
      this.clipPath = this._editModeClipPath;
      this._editModeClipPath = undefined;
    } else {
      this._updateClipPath();
    }

    // Restore caching setting
    if (this._editModeObjectCaching !== undefined) {
      this.objectCaching = this._editModeObjectCaching;
      this._editModeObjectCaching = undefined;
    }

    this.set('dirty', true);

    // Re-select the frame itself
    if (this.canvas) {
      this.canvas.setActiveObject(this);
      this.canvas.renderAll();
    }

    // Fire custom event
    (this as any).fire('frame:editmode:exit', { target: this });
  }

  /**
   * Toggles edit mode
   */
  toggleEditMode(): void {
    if (this.isEditMode) {
      this.exitEditMode();
    } else {
      this.enterEditMode();
    }
  }

  /**
   * Resizes the frame to new dimensions (Canva-like behavior)
   *
   * Canva behavior:
   * - When frame shrinks: crops more of image (no scale change)
   * - When frame grows: uncrops to show more, preserving position
   * - Only scales up when image can't cover the frame anymore
   *
   * @param width - New frame width
   * @param height - New frame height
   * @param options - Resize options
   */
  resizeFrame(
    width: number,
    height: number,
    options: { maintainAspect?: boolean } = {}
  ): void {
    const { maintainAspect = false } = options;

    if (maintainAspect) {
      const currentAspect = this.frameWidth / this.frameHeight;
      const newAspect = width / height;

      if (newAspect > currentAspect) {
        height = width / currentAspect;
      } else {
        width = height * currentAspect;
      }
    }

    this.frameWidth = width;
    this.frameHeight = height;

    // Update dimensions using super.set to avoid re-triggering conversion
    super.set({
      width: this.frameWidth,
      height: this.frameHeight,
    });

    // Update clip path
    this._updateClipPath();

    // Canva-like content adjustment
    this._adjustContentAfterResize();

    this.set('dirty', true);
    this.setCoords();
  }

  /**
   * Sets the frame shape
   *
   * @param shape - Shape type
   * @param customPath - Custom SVG path for 'custom' shape type
   */
  setFrameShape(shape: FrameShapeType, customPath?: string): void {
    this.frameShape = shape;
    if (customPath) {
      this.frameCustomPath = customPath;
    }
    this._updateClipPath();
    this.set('dirty', true);
  }

  /**
   * Sets the border radius for rounded-rect shape
   *
   * @param radius - Border radius in pixels
   */
  setBorderRadius(radius: number): void {
    this.frameBorderRadius = radius;
    if (this.frameShape === 'rounded-rect') {
      this._updateClipPath();
      this.set('dirty', true);
    }
  }

  /**
   * Override add to maintain fixed dimensions
   */
  add(...objects: FabricObject[]): number {
    const size = super.add(...objects);
    this._restoreFixedDimensions();
    return size;
  }

  /**
   * Override remove to maintain fixed dimensions
   */
  remove(...objects: FabricObject[]): FabricObject[] {
    const removed = super.remove(...objects);
    this._restoreFixedDimensions();
    return removed;
  }

  /**
   * Override insertAt to maintain fixed dimensions
   */
  insertAt(index: number, ...objects: FabricObject[]): number {
    const size = super.insertAt(index, ...objects);
    this._restoreFixedDimensions();
    return size;
  }

  /**
   * Serializes the frame to a plain object
   */
  // @ts-ignore - Frame extends Group's toObject with additional properties
  toObject(propertiesToInclude: string[] = []): any {
    return {
      ...(super.toObject as any)(propertiesToInclude),
      frameWidth: this.frameWidth,
      frameHeight: this.frameHeight,
      frameShape: this.frameShape,
      frameBorderRadius: this.frameBorderRadius,
      frameCustomPath: this.frameCustomPath,
      frameMeta: { ...this.frameMeta },
      isEditMode: false, // Always serialize as not in edit mode
      placeholderText: this.placeholderText,
      placeholderColor: this.placeholderColor,
    };
  }

  /**
   * Creates a Frame instance from a serialized object
   */
  static fromObject<T extends TOptions<SerializedFrameProps>>(
    object: T,
    abortable?: Abortable
  ): Promise<Frame> {
    const {
      objects = [],
      layoutManager,
      frameWidth,
      frameHeight,
      frameShape,
      frameBorderRadius,
      frameCustomPath,
      frameMeta,
      placeholderText,
      placeholderColor,
      ...groupOptions
    } = object;

    return Promise.all([
      enlivenObjects<FabricObject>(objects, abortable),
      enlivenObjectEnlivables(groupOptions, abortable),
    ]).then(([enlivenedObjects, hydratedOptions]) => {
      // Create frame with restored options
      const frame = new Frame([], {
        ...groupOptions,
        ...hydratedOptions,
        frameWidth,
        frameHeight,
        frameShape,
        frameBorderRadius,
        frameCustomPath,
        frameMeta: frameMeta ? {
          contentScale: frameMeta.contentScale ?? 1,
          contentOffsetX: frameMeta.contentOffsetX ?? 0,
          contentOffsetY: frameMeta.contentOffsetY ?? 0,
          ...frameMeta,
        } : undefined,
        placeholderText,
        placeholderColor,
      });

      // If there was an image, restore it
      if (frameMeta?.imageSrc) {
        // Async restoration of image - caller should wait if needed
        frame.setImage(frameMeta.imageSrc).then(() => {
          // Restore content position from metadata
          if (frame._contentImage) {
            frame._contentImage.set({
              left: frameMeta.contentOffsetX ?? 0,
              top: frameMeta.contentOffsetY ?? 0,
              scaleX: frameMeta.contentScale ?? 1,
              scaleY: frameMeta.contentScale ?? 1,
            });
          }
          frame.set('dirty', true);
        }).catch((err) => {
          console.warn('Failed to restore frame image:', err);
        });
      }

      return frame;
    });
  }

  /**
   * Creates a Frame with a specific aspect ratio preset
   *
   * @param aspect - Aspect ratio preset (e.g., '16:9', '1:1', '4:5', '9:16')
   * @param size - Base size in pixels
   * @param options - Additional frame options
   */
  static createWithAspect(
    aspect: string,
    size: number = 200,
    options: Partial<FrameProps> = {}
  ): Frame {
    let width: number;
    let height: number;

    switch (aspect) {
      case '16:9':
        width = size;
        height = size * (9 / 16);
        break;
      case '9:16':
        width = size * (9 / 16);
        height = size;
        break;
      case '4:5':
        width = size * (4 / 5);
        height = size;
        break;
      case '4:3':
        width = size;
        height = size * (3 / 4);
        break;
      case '3:4':
        width = size * (3 / 4);
        height = size;
        break;
      case '1:1':
      default:
        width = size;
        height = size;
        break;
    }

    const defaultMeta = frameDefaultValues.frameMeta || {};

    return new Frame([], {
      ...options,
      frameWidth: width,
      frameHeight: height,
      frameMeta: {
        contentScale: defaultMeta.contentScale ?? 1,
        contentOffsetX: defaultMeta.contentOffsetX ?? 0,
        contentOffsetY: defaultMeta.contentOffsetY ?? 0,
        aspect,
        ...options.frameMeta,
      },
    });
  }
}

// Register the Frame class with the class registry
classRegistry.setClass(Frame);
classRegistry.setClass(Frame, 'frame');
