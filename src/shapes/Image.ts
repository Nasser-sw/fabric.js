import { getFabricDocument, getEnv } from '../env';
import type { Control } from '../controls/Control';
import { createImageCropControls, createImageCropModeControls } from '../controls/imageCropControls';
import type { BaseFilter } from '../filters/BaseFilter';
import { getFilterBackend } from '../filters/FilterBackend';
import { SHARED_ATTRIBUTES } from '../parser/attributes';
import { parseAttributes } from '../parser/parseAttributes';
import type {
  TClassProperties,
  TCrossOrigin,
  TSize,
  Abortable,
  TOptions,
} from '../typedefs';
import { uid } from '../util/internals/uid';
import { createCanvasElementFor } from '../util/misc/dom';
import { findScaleToCover, findScaleToFit } from '../util/misc/findScaleTo';
import type { LoadImageOptions } from '../util/misc/objectEnlive';
import {
  enlivenObjectEnlivables,
  enlivenObjects,
  loadImage,
} from '../util/misc/objectEnlive';
import { parsePreserveAspectRatioAttribute } from '../util/misc/svgParsing';
import { classRegistry } from '../ClassRegistry';
import { FabricObject, cacheProperties } from './Object/FabricObject';
import type { FabricObjectProps, SerializedObjectProps } from './Object/types';
import type { ObjectEvents } from '../EventTypeDefs';
import { WebGLFilterBackend } from '../filters/WebGLFilterBackend';
import { FILL, NONE } from '../constants';
import { getDocumentFromElement } from '../util/dom_misc';
import type { CSSRules } from '../parser/typedefs';
import type { Resize, ResizeSerializedProps } from '../filters/Resize';
import type { TCachedFabricObject } from './Object/Object';
import { log } from '../util/internals/console';

// @todo Would be nice to have filtering code not imported directly.

export type ImageSource =
  | HTMLImageElement
  | HTMLVideoElement
  | HTMLCanvasElement;

interface UniqueImageProps {
  srcFromAttribute: boolean;
  minimumScaleTrigger: number;
  cropX: number;
  cropY: number;
  imageSmoothing: boolean;
  filters: BaseFilter<string, Record<string, any>>[];
  resizeFilter?: Resize;
}

export const imageDefaultValues: Partial<TClassProperties<FabricImage>> = {
  strokeWidth: 0,
  srcFromAttribute: false,
  minimumScaleTrigger: 0.5,
  cropX: 0,
  cropY: 0,
  imageSmoothing: true,
  cropMode: false,
};

export interface SerializedImageProps extends SerializedObjectProps {
  src: string;
  crossOrigin: TCrossOrigin;
  filters: any[];
  resizeFilter?: ResizeSerializedProps;
  cropX: number;
  cropY: number;
}

export interface ImageProps extends FabricObjectProps, UniqueImageProps {}

const IMAGE_PROPS = ['cropX', 'cropY'] as const;

/**
 * @see {@link http://fabricjs.com/fabric-intro-part-1#images}
 */
export class FabricImage<
    Props extends TOptions<ImageProps> = Partial<ImageProps>,
    SProps extends SerializedImageProps = SerializedImageProps,
    EventSpec extends ObjectEvents = ObjectEvents,
  >
  extends FabricObject<Props, SProps, EventSpec>
  implements ImageProps
{
  /**
   * When calling {@link FabricImage.getSrc}, return value from element src with `element.getAttribute('src')`.
   * This allows for relative urls as image src.
   * @since 2.7.0
   * @type Boolean
   * @default false
   */
  declare srcFromAttribute: boolean;

  /**
   * private
   * contains last value of scaleX to detect
   * if the Image got resized after the last Render
   * @type Number
   */
  protected _lastScaleX = 1;

  /**
   * private
   * contains last value of scaleY to detect
   * if the Image got resized after the last Render
   * @type Number
   */
  protected _lastScaleY = 1;

  /**
   * private
   * contains last value of scaling applied by the apply filter chain
   * @type Number
   */
  protected _filterScalingX = 1;

  /**
   * private
   * contains last value of scaling applied by the apply filter chain
   * @type Number
   */
  protected _filterScalingY = 1;

  /**
   * minimum scale factor under which any resizeFilter is triggered to resize the image
   * 0 will disable the automatic resize. 1 will trigger automatically always.
   * number bigger than 1 are not implemented yet.
   * @type Number
   */
  declare minimumScaleTrigger: number;

  /**
   * key used to retrieve the texture representing this image
   * @since 2.0.0
   * @type String
   */
  declare cacheKey: string;

  /**
   * Image crop in pixels from original image size.
   * @since 2.0.0
   * @type Number
   */
  declare cropX: number;

  /**
   * Image crop in pixels from original image size.
   * @since 2.0.0
   * @type Number
   */
  declare cropY: number;

  /**
   * Indicates whether this canvas will use image smoothing when painting this image.
   * Also influence if the cacheCanvas for this image uses imageSmoothing
   * @since 4.0.0-beta.11
   * @type Boolean
   */
  declare imageSmoothing: boolean;

  declare preserveAspectRatio: string;

  declare protected src: string;

  declare filters: BaseFilter<string, Record<string, any>>[];
  declare resizeFilter: Resize;

  declare _element: ImageSource;
  declare _filteredEl?: HTMLCanvasElement;
  declare _originalElement: ImageSource;

  /**
   * Whether the image is in crop mode (double-click to enter)
   */
  declare cropMode: boolean;

  /**
   * Backup of normal controls when entering crop mode
   */
  private _normalControls?: Record<string, Control>;

  /**
   * Original position and crop values for drag-to-reposition in crop mode
   * Updated at the start of each drag
   */
  private _cropModeOriginalLeft?: number;
  private _cropModeOriginalTop?: number;
  private _cropModeOriginalCropX?: number;
  private _cropModeOriginalCropY?: number;
  private _cropModeDragActive?: boolean;

  static type = 'Image';

  static cacheProperties = [...cacheProperties, ...IMAGE_PROPS];

  static ownDefaults = imageDefaultValues;

  static getDefaults(): Record<string, any> {
    return {
      ...super.getDefaults(),
      ...FabricImage.ownDefaults,
    };
  }

  /**
   * Creates Canva-like controls for images
   * - All handles scale uniformly
   * - Double-click to enter crop mode
   */
  static createControls(): { controls: Record<string, Control> } {
    return { controls: createImageCropControls() };
  }

  /**
   * Enter crop mode - switches to crop controls
   * Call this on double-click
   */
  enterCropMode(): void {
    if (this.cropMode) return;

    this.cropMode = true;
    // Backup current controls
    this._normalControls = { ...this.controls };
    // Switch to crop mode controls
    this.controls = createImageCropModeControls();
    // Dirty cache to force re-render with full image visible
    this.dirty = true;
    // Reset drag state
    this._cropModeDragActive = false;
    this.setCoords();
    this.canvas?.requestRenderAll();
  }

  /**
   * Exit crop mode - restores normal controls
   * Call this on click outside or escape
   */
  exitCropMode(): void {
    if (!this.cropMode) return;

    this.cropMode = false;
    // Restore normal controls
    if (this._normalControls) {
      this.controls = this._normalControls;
      this._normalControls = undefined;
    } else {
      this.controls = createImageCropControls();
    }
    // Dirty cache to force re-render with cropped image only
    this.dirty = true;
    this.setCoords();
    this.canvas?.requestRenderAll();
  }

  /**
   * Toggle crop mode
   */
  toggleCropMode(): void {
    if (this.cropMode) {
      this.exitCropMode();
    } else {
      this.enterCropMode();
    }
  }

  /**
   * Override set to intercept movement in crop mode
   * In crop mode, dragging adjusts cropX/cropY instead of left/top
   */
  // @ts-ignore - override set with different signature for crop mode handling
  set(key: string | Record<string, unknown>, value?: unknown): this {
    // Only intercept in crop mode when actually dragging (isMoving is true)
    if (this.cropMode && this.isMoving && typeof key === 'string') {
      if (key === 'left' && typeof value === 'number') {
        return this._setCropModePosition('left', value);
      }
      if (key === 'top' && typeof value === 'number') {
        return this._setCropModePosition('top', value);
      }
    }
    return super.set(key as string, value);
  }

  /**
   * Handle position changes in crop mode - converts to cropX/cropY changes
   * @private
   */
  private _setCropModePosition(axis: 'left' | 'top', newPos: number): this {
    const element = this._element as HTMLImageElement;
    if (!element) {
      return super.set(axis, newPos);
    }

    // Capture baseline values at the start of each new drag
    if (!this._cropModeDragActive) {
      this._cropModeDragActive = true;
      this._cropModeOriginalLeft = this.left;
      this._cropModeOriginalTop = this.top;
      this._cropModeOriginalCropX = this.cropX;
      this._cropModeOriginalCropY = this.cropY;
    }

    const scale = axis === 'left' ? (this.scaleX || 1) : (this.scaleY || 1);
    const basePos = axis === 'left' ? this._cropModeOriginalLeft : this._cropModeOriginalTop;
    const baseCrop = axis === 'left' ? this._cropModeOriginalCropX : this._cropModeOriginalCropY;
    const cropProp = axis === 'left' ? 'cropX' : 'cropY';
    const sizeProp = axis === 'left' ? 'width' : 'height';
    const elSize = axis === 'left'
      ? (element.naturalWidth || element.width)
      : (element.naturalHeight || element.height);

    if (basePos === undefined || baseCrop === undefined) {
      return super.set(axis, newPos);
    }

    // Calculate total delta from drag start position
    const totalDelta = newPos - basePos;

    // Convert screen delta to source image pixels
    // Dragging right (positive delta) should make the image follow the cursor
    // Use Math.abs(scale) to handle flipped images.
    const cropOffset = totalDelta / Math.abs(scale);

    // Calculate new crop value from baseline crop + offset
    const currentSize = (this[sizeProp] as number) || elSize;
    let newCrop = baseCrop + cropOffset;

    // Clamp to valid range: 0 to (elSize - visible size)
    const maxCrop = Math.max(0, elSize - currentSize);
    newCrop = Math.max(0, Math.min(maxCrop, newCrop));

    // Update crop value
    super.set(cropProp, newCrop);
    // Keep position fixed at baseline
    super.set(axis, basePos);
    // Mark as dirty for re-render
    this.dirty = true;

    return this;
  }

  /**
   * Reset crop mode drag state when drag ends
   * Called by canvas on mouse up
   */
  _onMouseUp(): void {
    if (this.cropMode) {
      this._cropModeDragActive = false;
    }
  }

  /**
   * Constructor
   * Image can be initialized with any canvas drawable or a string.
   * The string should be a url and will be loaded as an image.
   * Canvas and Image element work out of the box, while videos require extra code to work.
   * Please check video element events for seeking.
   * @param {ImageSource | string} element Image element
   * @param {Object} [options] Options object
   */
  constructor(elementId: string, options?: Props);
  constructor(element: ImageSource, options?: Props);
  constructor(arg0: ImageSource | string, options?: Props) {
    super();
    this.filters = [];
    Object.assign(this, FabricImage.ownDefaults);
    this.setOptions(options);
    this.cacheKey = `texture${uid()}`;
    this.setElement(
      typeof arg0 === 'string'
        ? ((
            (this.canvas && getDocumentFromElement(this.canvas.getElement())) ||
            getFabricDocument()
          ).getElementById(arg0) as ImageSource)
        : arg0,
      options,
    );
  }

  /**
   * Returns image element which this instance if based on
   */
  getElement() {
    return this._element;
  }

  /**
   * Sets image element for this instance to a specified one.
   * If filters defined they are applied to new image.
   * You might need to call `canvas.renderAll` and `object.setCoords` after replacing, to render new image and update controls area.
   * @param {HTMLImageElement} element
   * @param {Partial<TSize>} [size] Options object
   */
  setElement(element: ImageSource, size: Partial<TSize> = {}) {
    this.removeTexture(this.cacheKey);
    this.removeTexture(`${this.cacheKey}_filtered`);
    this._element = element;
    this._originalElement = element;
    this._setWidthHeight(size);
    if (this.filters.length !== 0) {
      this.applyFilters();
    }
    // resizeFilters work on the already filtered copy.
    // we need to apply resizeFilters AFTER normal filters.
    // applyResizeFilters is run more often than normal filters
    // and is triggered by user interactions rather than dev code
    if (this.resizeFilter) {
      this.applyResizeFilters();
    }
  }

  /**
   * Delete a single texture if in webgl mode
   */
  removeTexture(key: string) {
    const backend = getFilterBackend(false);
    if (backend instanceof WebGLFilterBackend) {
      backend.evictCachesForKey(key);
    }
  }

  /**
   * Delete textures, reference to elements and eventually JSDOM cleanup
   */
  dispose() {
    super.dispose();
    this.removeTexture(this.cacheKey);
    this.removeTexture(`${this.cacheKey}_filtered`);
    this._cacheContext = null;
    (
      ['_originalElement', '_element', '_filteredEl', '_cacheCanvas'] as const
    ).forEach((elementKey) => {
      const el = this[elementKey];
      el && getEnv().dispose(el);
      // @ts-expect-error disposing
      this[elementKey] = undefined;
    });
  }

  /**
   * Get the crossOrigin value (of the corresponding image element)
   */
  getCrossOrigin(): string | null {
    return (
      this._originalElement &&
      ((this._originalElement as any).crossOrigin || null)
    );
  }

  /**
   * Returns original size of an image
   */
  getOriginalSize() {
    const element = this.getElement() as any;
    if (!element) {
      return {
        width: 0,
        height: 0,
      };
    }
    return {
      width: element.naturalWidth || element.width,
      height: element.naturalHeight || element.height,
    };
  }

  /**
   * @private
   * @param {CanvasRenderingContext2D} ctx Context to render on
   */
  _stroke(ctx: CanvasRenderingContext2D) {
    if (!this.stroke || this.strokeWidth === 0) {
      return;
    }
    const w = this.width / 2,
      h = this.height / 2;
    ctx.beginPath();
    ctx.moveTo(-w, -h);
    ctx.lineTo(w, -h);
    ctx.lineTo(w, h);
    ctx.lineTo(-w, h);
    ctx.lineTo(-w, -h);
    ctx.closePath();
  }

  /**
   * Returns object representation of an instance
   * @param {Array} [propertiesToInclude] Any properties that you might want to additionally include in the output
   * @return {Object} Object representation of an instance
   */
  toObject<
    T extends Omit<Props & TClassProperties<this>, keyof SProps>,
    K extends keyof T = never,
  >(propertiesToInclude: K[] = []): Pick<T, K> & SProps {
    const filters: Record<string, any>[] = [];
    this.filters.forEach((filterObj) => {
      filterObj && filters.push(filterObj.toObject());
    });
    return {
      ...super.toObject([...IMAGE_PROPS, ...propertiesToInclude]),
      src: this.getSrc(),
      crossOrigin: this.getCrossOrigin(),
      filters,
      ...(this.resizeFilter
        ? { resizeFilter: this.resizeFilter.toObject() }
        : {}),
    };
  }

  /**
   * Returns true if an image has crop applied, inspecting values of cropX,cropY,width,height.
   * @return {Boolean}
   */
  hasCrop() {
    return (
      !!this.cropX ||
      !!this.cropY ||
      this.width < this._element.width ||
      this.height < this._element.height
    );
  }

  /**
   * Returns svg representation of an instance
   * @return {string[]} an array of strings with the specific svg representation
   * of the instance
   */
  _toSVG() {
    const imageMarkup: string[] = [],
      element = this._element,
      x = -this.width / 2,
      y = -this.height / 2;
    let svgString: string[] = [],
      strokeSvg: string[] = [],
      clipPath = '',
      imageRendering = '';
    if (!element) {
      return [];
    }
    if (this.hasCrop()) {
      const clipPathId = uid();
      svgString.push(
        '<clipPath id="imageCrop_' + clipPathId + '">\n',
        '\t<rect x="' +
          x +
          '" y="' +
          y +
          '" width="' +
          this.width +
          '" height="' +
          this.height +
          '" />\n',
        '</clipPath>\n',
      );
      clipPath = ' clip-path="url(#imageCrop_' + clipPathId + ')" ';
    }
    if (!this.imageSmoothing) {
      imageRendering = ' image-rendering="optimizeSpeed"';
    }
    imageMarkup.push(
      '\t<image ',
      'COMMON_PARTS',
      `xlink:href="${this.getSvgSrc(true)}" x="${x - this.cropX}" y="${
        y - this.cropY
        // we're essentially moving origin of transformation from top/left corner to the center of the shape
        // by wrapping it in container <g> element with actual transformation, then offsetting object to the top/left
        // so that object's center aligns with container's left/top
      }" width="${
        element.width || (element as HTMLImageElement).naturalWidth
      }" height="${
        element.height || (element as HTMLImageElement).naturalHeight
      }"${imageRendering}${clipPath}></image>\n`,
    );

    if (this.stroke || this.strokeDashArray) {
      const origFill = this.fill;
      this.fill = null;
      strokeSvg = [
        `\t<rect x="${x}" y="${y}" width="${this.width}" height="${
          this.height
        }" style="${this.getSvgStyles()}" />\n`,
      ];
      this.fill = origFill;
    }
    if (this.paintFirst !== FILL) {
      svgString = svgString.concat(strokeSvg, imageMarkup);
    } else {
      svgString = svgString.concat(imageMarkup, strokeSvg);
    }
    return svgString;
  }

  /**
   * Returns source of an image
   * @param {Boolean} filtered indicates if the src is needed for svg
   * @return {String} Source of an image
   */
  getSrc(filtered?: boolean): string {
    const element = filtered ? this._element : this._originalElement;
    if (element) {
      if ((element as HTMLCanvasElement).toDataURL) {
        return (element as HTMLCanvasElement).toDataURL();
      }

      if (this.srcFromAttribute) {
        return element.getAttribute('src') || '';
      } else {
        return (element as HTMLImageElement).src;
      }
    } else {
      return this.src || '';
    }
  }

  /**
   * Alias for getSrc
   * @param filtered
   * @deprecated
   */
  getSvgSrc(filtered?: boolean) {
    return this.getSrc(filtered);
  }

  /**
   * Loads and sets source of an image\
   * **IMPORTANT**: It is recommended to abort loading tasks before calling this method to prevent race conditions and unnecessary networking
   * @param {String} src Source string (URL)
   * @param {LoadImageOptions} [options] Options object
   */
  setSrc(src: string, { crossOrigin, signal }: LoadImageOptions = {}) {
    return loadImage(src, { crossOrigin, signal }).then((img) => {
      typeof crossOrigin !== 'undefined' && this.set({ crossOrigin });
      this.setElement(img);
    });
  }

  /**
   * Returns string representation of an instance
   * @return {String} String representation of an instance
   */
  toString() {
    return `#<Image: { src: "${this.getSrc()}" }>`;
  }

  applyResizeFilters() {
    const filter = this.resizeFilter,
      minimumScale = this.minimumScaleTrigger,
      objectScale = this.getTotalObjectScaling(),
      scaleX = objectScale.x,
      scaleY = objectScale.y,
      elementToFilter = this._filteredEl || this._originalElement;
    if (this.group) {
      this.set('dirty', true);
    }
    if (!filter || (scaleX > minimumScale && scaleY > minimumScale)) {
      this._element = elementToFilter;
      this._filterScalingX = 1;
      this._filterScalingY = 1;
      this._lastScaleX = scaleX;
      this._lastScaleY = scaleY;
      return;
    }
    const canvasEl = createCanvasElementFor(elementToFilter),
      { width, height } = elementToFilter;
    this._element = canvasEl;
    this._lastScaleX = filter.scaleX = scaleX;
    this._lastScaleY = filter.scaleY = scaleY;
    getFilterBackend().applyFilters(
      [filter],
      elementToFilter,
      width,
      height,
      this._element,
    );
    this._filterScalingX = canvasEl.width / this._originalElement.width;
    this._filterScalingY = canvasEl.height / this._originalElement.height;
  }

  /**
   * Applies filters assigned to this image (from "filters" array) or from filter param
   * @param {Array} filters to be applied
   * @param {Boolean} forResizing specify if the filter operation is a resize operation
   */
  applyFilters(
    filters: BaseFilter<string, Record<string, any>>[] = this.filters || [],
  ) {
    filters = filters.filter((filter) => filter && !filter.isNeutralState());
    this.set('dirty', true);

    // needs to clear out or WEBGL will not resize correctly
    this.removeTexture(`${this.cacheKey}_filtered`);

    if (filters.length === 0) {
      this._element = this._originalElement;
      // this is unsafe and needs to be rethinkend
      this._filteredEl = undefined;
      this._filterScalingX = 1;
      this._filterScalingY = 1;
      return;
    }

    const imgElement = this._originalElement,
      sourceWidth =
        (imgElement as HTMLImageElement).naturalWidth || imgElement.width,
      sourceHeight =
        (imgElement as HTMLImageElement).naturalHeight || imgElement.height;

    if (this._element === this._originalElement) {
      // if the _element a reference to _originalElement
      // we need to create a new element to host the filtered pixels
      const canvasEl = createCanvasElementFor({
        width: sourceWidth,
        height: sourceHeight,
      });
      this._element = canvasEl;
      this._filteredEl = canvasEl;
    } else if (this._filteredEl) {
      // if the _element is it own element,
      // and we also have a _filteredEl, then we clean up _filteredEl
      // and we assign it to _element.
      // in this way we invalidate the eventual old resize filtered element
      this._element = this._filteredEl;
      this._filteredEl
        .getContext('2d')!
        .clearRect(0, 0, sourceWidth, sourceHeight);
      // we also need to resize again at next renderAll, so remove saved _lastScaleX/Y
      this._lastScaleX = 1;
      this._lastScaleY = 1;
    }
    getFilterBackend().applyFilters(
      filters,
      this._originalElement,
      sourceWidth,
      sourceHeight,
      this._element as HTMLCanvasElement,
      this.cacheKey,
    );
    if (
      this._originalElement.width !== this._element.width ||
      this._originalElement.height !== this._element.height
    ) {
      this._filterScalingX = this._element.width / this._originalElement.width;
      this._filterScalingY =
        this._element.height / this._originalElement.height;
    }
  }

  /**
   * @private
   * @param {CanvasRenderingContext2D} ctx Context to render on
   */
  _render(ctx: CanvasRenderingContext2D) {
    ctx.imageSmoothingEnabled = this.imageSmoothing;
    if (this.isMoving !== true && this.resizeFilter && this._needsResize()) {
      this.applyResizeFilters();
    }
    this._stroke(ctx);
    this._renderPaintInOrder(ctx);
  }

  /**
   * Paint the cached copy of the object on the target context.
   * it will set the imageSmoothing for the draw operation
   * @param {CanvasRenderingContext2D} ctx Context to render on
   */
  drawCacheOnCanvas(
    this: TCachedFabricObject<FabricImage>,
    ctx: CanvasRenderingContext2D,
  ) {
    ctx.imageSmoothingEnabled = this.imageSmoothing;
    super.drawCacheOnCanvas(ctx);
  }

  /**
   * Decide if the FabricImage should cache or not. Create its own cache level
   * needsItsOwnCache should be used when the object drawing method requires
   * a cache step.
   * Generally you do not cache objects in groups because the group outside is cached.
   * This is the special Image version where we would like to avoid caching where possible.
   * Essentially images do not benefit from caching. They may require caching, and in that
   * case we do it. Also caching an image usually ends in a loss of details.
   * A full performance audit should be done.
   * @return {Boolean}
   */
  shouldCache() {
    // Don't cache in crop mode - we need to render the full image
    if (this.cropMode) {
      return false;
    }
    return this.needsItsOwnCache();
  }

  _renderFill(ctx: CanvasRenderingContext2D) {
    const elementToDraw = this._element;
    if (!elementToDraw) {
      return;
    }
    const scaleX = this._filterScalingX,
      scaleY = this._filterScalingY,
      w = this.width,
      h = this.height,
      // crop values cannot be lesser than 0.
      cropX = Math.max(this.cropX, 0),
      cropY = Math.max(this.cropY, 0),
      elWidth =
        (elementToDraw as HTMLImageElement).naturalWidth || elementToDraw.width,
      elHeight =
        (elementToDraw as HTMLImageElement).naturalHeight ||
        elementToDraw.height,
      sX = cropX * scaleX,
      sY = cropY * scaleY,
      // the width height cannot exceed element width/height, starting from the crop offset.
      sW = Math.min(w * scaleX, elWidth - sX),
      sH = Math.min(h * scaleY, elHeight - sY),
      x = -w / 2,
      y = -h / 2,
      maxDestW = Math.min(w, elWidth / scaleX - cropX),
      maxDestH = Math.min(h, elHeight / scaleY - cropY);

    if (this.cropMode) {
      // In crop mode: show full image with crop area highlighted
      this._renderCropMode(ctx, elementToDraw, elWidth, elHeight, scaleX, scaleY);
    } else {
      // Normal mode: just draw the cropped portion
      elementToDraw &&
        ctx.drawImage(elementToDraw, sX, sY, sW, sH, x, y, maxDestW, maxDestH);
    }
  }

  /**
   * Render the image in crop mode - shows full image dimmed with crop area highlighted
   * @private
   */
  _renderCropMode(
    ctx: CanvasRenderingContext2D,
    elementToDraw: CanvasImageSource,
    elWidth: number,
    elHeight: number,
    scaleX: number,
    scaleY: number,
  ) {
    const w = this.width,
      h = this.height,
      cropX = Math.max(this.cropX, 0),
      cropY = Math.max(this.cropY, 0);

    // Calculate full image dimensions at current scale
    const fullW = elWidth / scaleX;
    const fullH = elHeight / scaleY;

    // Position of the full image (crop area is centered at 0,0)
    // The crop window starts at (cropX, cropY) in the original image
    // We want the crop window to be at (-w/2, -h/2) to (w/2, h/2)
    // So the full image starts at (-w/2 - cropX, -h/2 - cropY)
    const fullX = -w / 2 - cropX;
    const fullY = -h / 2 - cropY;

    // Draw the FULL image dimmed (outside crop area)
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.drawImage(
      elementToDraw,
      0, 0, elWidth, elHeight,  // source: full image
      fullX, fullY, fullW, fullH,  // dest: positioned so crop area is centered
    );
    ctx.restore();

    // Draw dark overlay on the dimmed parts (outside crop area)
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    // Left side
    if (cropX > 0) {
      ctx.fillRect(fullX, fullY, cropX, fullH);
    }
    // Right side
    const rightStart = -w / 2 + w;
    const rightWidth = fullW - cropX - w;
    if (rightWidth > 0) {
      ctx.fillRect(rightStart, fullY, rightWidth, fullH);
    }
    // Top side (between left and right)
    if (cropY > 0) {
      ctx.fillRect(-w / 2, fullY, w, cropY);
    }
    // Bottom side (between left and right)
    const bottomStart = -h / 2 + h;
    const bottomHeight = fullH - cropY - h;
    if (bottomHeight > 0) {
      ctx.fillRect(-w / 2, bottomStart, w, bottomHeight);
    }
    ctx.restore();

    // Draw the crop area at FULL opacity
    const sX = cropX * scaleX,
      sY = cropY * scaleY,
      sW = Math.min(w * scaleX, elWidth - sX),
      sH = Math.min(h * scaleY, elHeight - sY),
      x = -w / 2,
      y = -h / 2,
      maxDestW = Math.min(w, elWidth / scaleX - cropX),
      maxDestH = Math.min(h, elHeight / scaleY - cropY);

    ctx.drawImage(elementToDraw, sX, sY, sW, sH, x, y, maxDestW, maxDestH);

    // Draw a border around the crop area
    ctx.save();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    ctx.restore();
  }

  /**
   * needed to check if image needs resize
   * @private
   */
  _needsResize() {
    const scale = this.getTotalObjectScaling();
    return scale.x !== this._lastScaleX || scale.y !== this._lastScaleY;
  }

  /**
   * @private
   * @deprecated unused
   */
  _resetWidthHeight() {
    this.set(this.getOriginalSize());
  }

  /**
   * @private
   * Set the width and the height of the image object, using the element or the
   * options.
   */
  _setWidthHeight({ width, height }: Partial<TSize> = {}) {
    const size = this.getOriginalSize();
    this.width = width || size.width;
    this.height = height || size.height;
  }

  /**
   * Calculate offset for center and scale factor for the image in order to respect
   * the preserveAspectRatio attribute
   * @private
   */
  parsePreserveAspectRatioAttribute() {
    const pAR = parsePreserveAspectRatioAttribute(
        this.preserveAspectRatio || '',
      ),
      pWidth = this.width,
      pHeight = this.height,
      parsedAttributes = { width: pWidth, height: pHeight };
    let rWidth = this._element.width,
      rHeight = this._element.height,
      scaleX = 1,
      scaleY = 1,
      offsetLeft = 0,
      offsetTop = 0,
      cropX = 0,
      cropY = 0,
      offset;

    if (pAR && (pAR.alignX !== NONE || pAR.alignY !== NONE)) {
      if (pAR.meetOrSlice === 'meet') {
        scaleX = scaleY = findScaleToFit(this._element, parsedAttributes);
        offset = (pWidth - rWidth * scaleX) / 2;
        if (pAR.alignX === 'Min') {
          offsetLeft = -offset;
        }
        if (pAR.alignX === 'Max') {
          offsetLeft = offset;
        }
        offset = (pHeight - rHeight * scaleY) / 2;
        if (pAR.alignY === 'Min') {
          offsetTop = -offset;
        }
        if (pAR.alignY === 'Max') {
          offsetTop = offset;
        }
      }
      if (pAR.meetOrSlice === 'slice') {
        scaleX = scaleY = findScaleToCover(this._element, parsedAttributes);
        offset = rWidth - pWidth / scaleX;
        if (pAR.alignX === 'Mid') {
          cropX = offset / 2;
        }
        if (pAR.alignX === 'Max') {
          cropX = offset;
        }
        offset = rHeight - pHeight / scaleY;
        if (pAR.alignY === 'Mid') {
          cropY = offset / 2;
        }
        if (pAR.alignY === 'Max') {
          cropY = offset;
        }
        rWidth = pWidth / scaleX;
        rHeight = pHeight / scaleY;
      }
    } else {
      scaleX = pWidth / rWidth;
      scaleY = pHeight / rHeight;
    }
    return {
      width: rWidth,
      height: rHeight,
      scaleX,
      scaleY,
      offsetLeft,
      offsetTop,
      cropX,
      cropY,
    };
  }

  /**
   * List of attribute names to account for when parsing SVG element (used by {@link FabricImage.fromElement})
   * @see {@link http://www.w3.org/TR/SVG/struct.html#ImageElement}
   */
  static ATTRIBUTE_NAMES = [
    ...SHARED_ATTRIBUTES,
    'x',
    'y',
    'width',
    'height',
    'preserveAspectRatio',
    'xlink:href',
    'href',
    'crossOrigin',
    'image-rendering',
  ];

  /**
   * Creates an instance of FabricImage from its object representation
   * @param {Object} object Object to create an instance from
   * @param {object} [options] Options object
   * @param {AbortSignal} [options.signal] handle aborting, see https://developer.mozilla.org/en-US/docs/Web/API/AbortController/signal
   * @returns {Promise<FabricImage>}
   */
  static fromObject<T extends TOptions<SerializedImageProps>>(
    { filters: f, resizeFilter: rf, src, crossOrigin, type, ...object }: T,
    options?: Abortable,
  ) {
    return Promise.all([
      loadImage(src!, { ...options, crossOrigin }),
      f && enlivenObjects<BaseFilter<string>>(f, options),
      // redundant - handled by enlivenObjectEnlivables, but nicely explicit
      rf ? enlivenObjects<Resize>([rf], options) : [],
      enlivenObjectEnlivables(object, options),
    ]).then(([el, filters = [], [resizeFilter], hydratedProps = {}]) => {
      return new this(el, {
        ...object,
        // TODO: passing src creates a difference between image creation and restoring from JSON
        src,
        filters,
        resizeFilter,
        ...hydratedProps,
      });
    });
  }

  /**
   * Creates an instance of Image from an URL string
   * @param {String} url URL to create an image from
   * @param {LoadImageOptions} [options] Options object
   * @returns {Promise<FabricImage>}
   */
  static fromURL<T extends TOptions<ImageProps>>(
    url: string,
    { crossOrigin = null, signal }: LoadImageOptions = {},
    imageOptions?: T,
  ): Promise<FabricImage> {
    return loadImage(url, { crossOrigin, signal }).then(
      (img) => new this(img, imageOptions),
    );
  }

  /**
   * Returns {@link FabricImage} instance from an SVG element
   * @param {HTMLElement} element Element to parse
   * @param {Object} [options] Options object
   * @param {AbortSignal} [options.signal] handle aborting, see https://developer.mozilla.org/en-US/docs/Web/API/AbortController/signal
   * @param {Function} callback Callback to execute when Image object is created
   */
  static async fromElement(
    element: HTMLElement,
    options: Abortable = {},
    cssRules?: CSSRules,
  ) {
    const parsedAttributes = parseAttributes(
      element,
      this.ATTRIBUTE_NAMES,
      cssRules,
    );
    return this.fromURL(
      parsedAttributes['xlink:href'] || parsedAttributes['href'],
      options,
      parsedAttributes,
    ).catch((err) => {
      log('log', 'Unable to parse Image', err);
      return null;
    });
  }
}

classRegistry.setClass(FabricImage);
classRegistry.setSVGClass(FabricImage);
