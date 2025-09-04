import { SHARED_ATTRIBUTES } from '../parser/attributes';
import { parseAttributes } from '../parser/parseAttributes';
import type { Abortable, TClassProperties, TOptions } from '../typedefs';
import { classRegistry } from '../ClassRegistry';
import { FabricObject, cacheProperties } from './Object/FabricObject';
import { Point } from '../Point';
import { isFiller } from '../util/typeAssertions';
import type { FabricObjectProps, SerializedObjectProps } from './Object/types';
import type { ObjectEvents } from '../EventTypeDefs';
import { makeBoundingBoxFromPoints } from '../util';
import { CENTER, LEFT, TOP } from '../constants';
import type { CSSRules } from '../parser/typedefs';
import { Control } from '../controls/Control';
import type { TPointerEvent, Transform } from '../EventTypeDefs';
import { invertTransform } from '../util/misc/matrix';

// @TODO this code is terrible and Line should be a special case of polyline.

const coordProps = ['x1', 'x2', 'y1', 'y2'] as const;

interface UniqueLineCoords {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}

interface UniqueLineProps extends UniqueLineCoords {}

export interface SerializedLineProps
  extends SerializedObjectProps,
    UniqueLineProps {}

/**
 * A Class to draw a line
 * A bunch of methods will be added to Polyline to handle the line case
 * The line class is very strange to work with, is all special, it hardly aligns
 * to what a developer want everytime there is an angle
 * @deprecated
 */
export class Line<
    Props extends TOptions<FabricObjectProps> = Partial<FabricObjectProps>,
    SProps extends SerializedLineProps = SerializedLineProps,
    EventSpec extends ObjectEvents = ObjectEvents,
  >
  extends FabricObject<Props, SProps, EventSpec>
  implements UniqueLineProps
{
  /**
   * x value or first line edge
   * @type number
   */
  declare x1: number;

  /**
   * y value or first line edge
   * @type number
   */
  declare y1: number;

  /**
   * x value or second line edge
   * @type number
   */
  declare x2: number;

  /**
   * y value or second line edge
   * @type number
   */
  declare y2: number;


  /**
   * Flag to prevent position feedback loop during endpoint dragging
   * @private
   */
  private _updatingEndpoints = false;

  static type = 'Line';

  static cacheProperties = [...cacheProperties, ...coordProps];
  /**
   * Constructor
   * @param {Array} [points] Array of points
   * @param {Object} [options] Options object
   * @return {Line} thisArg
   */
  constructor([x1, y1, x2, y2] = [0, 0, 100, 0], options: Partial<Props> = {}) {
    super();
    this.setOptions(options);
    this.x1 = x1;
    this.x2 = x2;
    this.y1 = y1;
    this.y2 = y2;
    
    // Set line-specific properties  
    this.hasBorders = false;
    this.hasControls = true;
    this.selectable = true;
    this.hoverCursor = 'move';
    this.moveCursor = 'move';
    this.lockMovementX = false;
    this.lockMovementY = false;
    this.lockRotation = true;
    this.lockScalingX = true;
    this.lockScalingY = true;
    this.lockSkewingX = true;
    this.lockSkewingY = true;
    
    this._setWidthHeight();
    const { left, top } = options;
    typeof left === 'number' && this.set(LEFT, left);
    typeof top === 'number' && this.set(TOP, top);
    this._setupLineControls();
  }

  /**
   * Setup line-specific controls for endpoints
   * @private
   */
  _setupLineControls() {
    this.controls = {
      p1: new Control({
        x: 0,
        y: 0,
        cursorStyle: 'move',
        actionHandler: this._endpointActionHandler.bind(this),
        positionHandler: this._p1PositionHandler.bind(this),
        render: this._renderEndpointControl.bind(this),
        sizeX: 12,
        sizeY: 12,
      }),
      p2: new Control({
        x: 0,
        y: 0,
        cursorStyle: 'move', 
        actionHandler: this._endpointActionHandler.bind(this),
        positionHandler: this._p2PositionHandler.bind(this),
        render: this._renderEndpointControl.bind(this),
        sizeX: 12,
        sizeY: 12,
      }),
    };
  }

  /**
   * Position handler for p1 control
   * @private
   */
  _p1PositionHandler(dim: Point, finalMatrix: any, fabricObject: Line) {
    // Transform absolute coordinates with viewport transform for zoom/pan
    const vpt = this.canvas?.viewportTransform || [1, 0, 0, 1, 0, 0];
    return new Point(this.x1, this.y1).transform(vpt);
  }

  /**
   * Position handler for p2 control
   * @private
   */
  _p2PositionHandler(dim: Point, finalMatrix: any, fabricObject: Line) {
    // Transform absolute coordinates with viewport transform for zoom/pan
    const vpt = this.canvas?.viewportTransform || [1, 0, 0, 1, 0, 0];
    return new Point(this.x2, this.y2).transform(vpt);
  }

  /**
   * Render control for line endpoints
   * @private
   */
  _renderEndpointControl(
    ctx: CanvasRenderingContext2D,
    left: number,
    top: number,
    styleOverride: any,
    fabricObject: Line,
  ) {
    const size = 12;
    ctx.save();
    ctx.fillStyle = '#007bff';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(left, top, size / 2, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Disable border drawing completely
   * @private
   */
  drawBorders(ctx: CanvasRenderingContext2D, styleOverride: any = {}) {
    // Do nothing - no borders for lines
    return this;
  }

  /**
   * Override to prevent clipping during control rendering
   * @private
   */
  _renderControls(ctx: CanvasRenderingContext2D, styleOverride: any = {}) {
    ctx.save();
    // Don't apply object transform to prevent clipping
    ctx.globalAlpha = this.isMoving ? this.borderOpacityWhenMoving : 1;
    
    // DEBUG: Visualize bounding box
    this._debugBoundingBox(ctx);
    
    this.drawControls(ctx, styleOverride);
    ctx.restore();
  }

  /**
   * Debug method to visualize bounding box
   * @private
   */
  _debugBoundingBox(ctx: CanvasRenderingContext2D) {
    const bbox = this.getBoundingRect();
    
    // Transform bounding box coordinates to screen space
    const vpt = this.canvas?.viewportTransform || [1, 0, 0, 1, 0, 0];
    const tl = new Point(bbox.left, bbox.top).transform(vpt);
    const br = new Point(bbox.left + bbox.width, bbox.top + bbox.height).transform(vpt);
    const screenBBox = {
      left: tl.x,
      top: tl.y,
      width: br.x - tl.x,
      height: br.y - tl.y
    };
    
    // Transform endpoints to screen space
    const p1Screen = new Point(this.x1, this.y1).transform(vpt);
    const p2Screen = new Point(this.x2, this.y2).transform(vpt);
    
    ctx.save();
    // Reset transform for screen space drawing
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    
    ctx.strokeStyle = this._updatingEndpoints ? 'red' : 'blue';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.globalAlpha = 0.7;
    
    // Draw bounding box in screen space
    ctx.strokeRect(screenBBox.left, screenBBox.top, screenBBox.width, screenBBox.height);
    
    // Draw center point
    ctx.fillStyle = this._updatingEndpoints ? 'red' : 'blue';
    ctx.fillRect(screenBBox.left + screenBBox.width / 2 - 2, screenBBox.top + screenBBox.height / 2 - 2, 4, 4);
    
    // Draw endpoints in screen space
    ctx.fillStyle = 'green';
    ctx.fillRect(p1Screen.x - 3, p1Screen.y - 3, 6, 6);
    ctx.fillRect(p2Screen.x - 3, p2Screen.y - 3, 6, 6);
    
    // Debug text
    ctx.fillStyle = 'black';
    ctx.font = '12px Arial';
    ctx.fillText(`BB: ${bbox.left.toFixed(0)},${bbox.top.toFixed(0)} ${bbox.width.toFixed(0)}x${bbox.height.toFixed(0)}`, screenBBox.left, screenBBox.top - 10);
    ctx.fillText(`P1: ${this.x1.toFixed(0)},${this.y1.toFixed(0)} P2: ${this.x2.toFixed(0)},${this.y2.toFixed(0)}`, screenBBox.left, screenBBox.top + screenBBox.height + 20);
    
    ctx.restore();
  }

  /**
   * Override getBoundingRect to use actual line endpoints instead of width/height
   * This prevents clipping during drag preview
   */
  getBoundingRect() {
    const { x1, y1, x2, y2 } = this;
    const strokeWidth = this.strokeWidth || 1;
    const padding = strokeWidth / 2;
    
    return {
      left: Math.min(x1, x2) - padding,
      top: Math.min(y1, y2) - padding,
      width: Math.abs(x2 - x1) + strokeWidth,
      height: Math.abs(y2 - y1) + strokeWidth
    };
  }


  /**
   * Action handler for endpoint controls
   * @private
   */
  _endpointActionHandler(
    eventData: TPointerEvent,
    transformData: Transform,
    x: number,
    y: number,
  ) {
    const controlKey = transformData.corner;
    const pointer = new Point(x, y);
    
    // DEBUG: Log coordinate conversion
    const vpt = this.canvas?.viewportTransform || [1, 0, 0, 1, 0, 0];
    console.log('Action handler coordinates:', {
      input: { x, y },
      pointer: pointer,
      vpt: vpt,
      currentEndpoints: { x1: this.x1, y1: this.y1, x2: this.x2, y2: this.y2 }
    });
    
    // The x,y parameters should already be in world coordinates since they come from the action handler
    // Don't transform them again - that would cause double transformation
    let newX = pointer.x;
    let newY = pointer.y;
    
    // Check if Shift is held for angle snapping
    const shiftHeld = eventData.shiftKey;
    
    if (shiftHeld) {
      if (controlKey === 'p1') {
        // Snap p1 relative to p2 (fixed point)
        const snapped = this._snapToAngle(this.x2, this.y2, newX, newY);
        newX = snapped.x;
        newY = snapped.y;
      } else if (controlKey === 'p2') {
        // Snap p2 relative to p1 (fixed point)
        const snapped = this._snapToAngle(this.x1, this.y1, newX, newY);
        newX = snapped.x;
        newY = snapped.y;
      }
    }
    
    console.log('Setting new coordinates:', { controlKey, newX, newY });
    
    // Set flag to prevent position feedback loop
    this._updatingEndpoints = true;
    
    if (controlKey === 'p1') {
      this.set('x1', newX);
      this.set('y1', newY);
    } else if (controlKey === 'p2') {
      this.set('x2', newX);
      this.set('y2', newY);
    }
    
    this._setWidthHeight(false); // Allow repositioning during drag to update center
    this._updatingEndpoints = false;
    
    return true;
  }

  /**
   * Snap angle to nearest increment when shift is held
   * @private
   */
  _snapToAngle(fromX: number, fromY: number, toX: number, toY: number): { x: number; y: number } {
    const deltaX = toX - fromX;
    const deltaY = toY - fromY;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    
    if (distance === 0) return { x: toX, y: toY };
    
    // Calculate current angle in degrees
    let angle = Math.atan2(deltaY, deltaX) * (180 / Math.PI);
    
    // Snap to 15-degree increments (0°, 15°, 30°, 45°, 60°, 75°, 90°, etc.)
    const snapIncrement = 15;
    const snappedAngle = Math.round(angle / snapIncrement) * snapIncrement;
    
    // Convert back to radians
    const snappedRadians = snappedAngle * (Math.PI / 180);
    
    // Calculate new position maintaining the same distance
    const newX = fromX + Math.cos(snappedRadians) * distance;
    const newY = fromY + Math.sin(snappedRadians) * distance;
    
    return { x: newX, y: newY };
  }

  /**
   * @private
   * @param {Object} [options] Options
   */
  _setWidthHeight(skipReposition = false) {
    const { x1, y1, x2, y2 } = this;
    this.width = Math.abs(x2 - x1) || 1;
    this.height = Math.abs(y2 - y1) || 1;
    
    if (!skipReposition) {
      const { left, top, width, height } = makeBoundingBoxFromPoints([
        { x: x1, y: y1 },
        { x: x2, y: y2 },
      ]);
      const position = new Point(left + width / 2, top + height / 2);
      this.setPositionByOrigin(position, CENTER, CENTER);
    }
  }

  /**
   * Update dimensions without repositioning - used during dragging
   * @private
   */
  _updateDimensionsOnly() {
    const { x1, y1, x2, y2 } = this;
    this.width = Math.abs(x2 - x1) || 1;
    this.height = Math.abs(y2 - y1) || 1;
  }



  /**
   * @private
   * @param {String} key
   * @param {*} value
   */
  _set(key: string, value: any) {
    const oldLeft = this.left;
    const oldTop = this.top;
    
    super._set(key, value);
    
    
    if (coordProps.includes(key as keyof UniqueLineProps)) {
      // this doesn't make sense very much, since setting x1 when top or left
      // are already set, is just going to show a strange result since the
      // line will move way more than the developer expect.
      // in fabric5 it worked only when the line didn't have extra transformations,
      // in fabric6 too. With extra transform they behave bad in different ways.
      // This needs probably a good rework or a tutorial if you have to create a dynamic line
      this._setWidthHeight();
    }
    
    // If position changed, update endpoint coordinates (but not during endpoint updates)
    if ((key === 'left' || key === 'top') && this.canvas && !this._updatingEndpoints) {
      const deltaX = this.left - oldLeft;
      const deltaY = this.top - oldTop;
      
      if (deltaX !== 0 || deltaY !== 0) {
        this._updatingEndpoints = true;
        this.x1 += deltaX;
        this.y1 += deltaY;
        this.x2 += deltaX;
        this.y2 += deltaY;
        this._updatingEndpoints = false;
      }
    }
    
    return this;
  }

  /**
   * @private
   * @param {CanvasRenderingContext2D} ctx Context to render on
   */
  _render(ctx: CanvasRenderingContext2D) {
    // During endpoint dragging, use proper coordinate system
    if (this._updatingEndpoints) {
      // Use relative coordinates from center, but update dimensions first
      this._updateDimensionsOnly();
      
      // Fall through to normal rendering with updated dimensions
      // This ensures zoom/pan work correctly
    }

    // Normal rendering path (used both normally and during drag)
    ctx.beginPath();

    const p = this.calcLinePoints();
    ctx.moveTo(p.x1, p.y1);
    ctx.lineTo(p.x2, p.y2);

    ctx.lineWidth = this.strokeWidth;
    
    // Line cap is handled by Fabric.js built-in strokeLineCap property
    // This will be set automatically by the parent class _renderStroke method

    // TODO: test this
    // make sure setting "fill" changes color of a line
    // (by copying fillStyle to strokeStyle, since line is stroked, not filled)
    const origStrokeStyle = ctx.strokeStyle;
    if (isFiller(this.stroke)) {
      ctx.strokeStyle = this.stroke.toLive(ctx)!;
    } else {
      ctx.strokeStyle = this.stroke ?? ctx.fillStyle;
    }
    this.stroke && this._renderStroke(ctx);
    ctx.strokeStyle = origStrokeStyle;
  }

  /**
   * This function is an helper for svg import. it returns the center of the object in the svg
   * untransformed coordinates
   * @private
   * @return {Point} center point from element coordinates
   */
  _findCenterFromElement(): Point {
    return new Point((this.x1 + this.x2) / 2, (this.y1 + this.y2) / 2);
  }

  /**
   * Returns object representation of an instance
   * @param {Array} [propertiesToInclude] Any properties that you might want to additionally include in the output
   * @return {Object} object representation of an instance
   */
  toObject<
    T extends Omit<Props & TClassProperties<this>, keyof SProps>,
    K extends keyof T = never,
  >(propertiesToInclude: K[] = []): Pick<T, K> & SProps {
    return {
      ...super.toObject(propertiesToInclude),
      ...this.calcLinePoints(),
    };
  }

  /*
   * Calculate object dimensions from its properties
   * @private
   */
  _getNonTransformedDimensions(): Point {
    const dim = super._getNonTransformedDimensions();
    if (this.strokeLineCap === 'butt') {
      if (this.width === 0) {
        dim.y -= this.strokeWidth;
      }
      if (this.height === 0) {
        dim.x -= this.strokeWidth;
      }
    }
    return dim;
  }

  /**
   * Recalculates line points given width and height
   * Those points are simply placed around the center,
   * This is not useful outside internal render functions and svg output
   * Is not meant to be for the developer.
   * @private
   */
  calcLinePoints(): UniqueLineCoords {
    // During endpoint dragging, use object's current center position
    if (this._updatingEndpoints) {
      // Use the object's left/top as center (which should be updated by _setWidthHeight)
      const centerX = this.left;
      const centerY = this.top;
      
      return {
        x1: this.x1 - centerX,
        y1: this.y1 - centerY,
        x2: this.x2 - centerX,
        y2: this.y2 - centerY,
      };
    }

    // Normal calculation based on width/height
    const { x1: _x1, x2: _x2, y1: _y1, y2: _y2, width, height } = this;
    const xMult = _x1 <= _x2 ? -1 : 1,
      yMult = _y1 <= _y2 ? -1 : 1,
      x1 = (xMult * width) / 2,
      y1 = (yMult * height) / 2,
      x2 = (xMult * -width) / 2,
      y2 = (yMult * -height) / 2;

    return {
      x1,
      x2,
      y1,
      y2,
    };
  }

  /* _FROM_SVG_START_ */

  /**
   * Returns svg representation of an instance
   * @return {Array} an array of strings with the specific svg representation
   * of the instance
   */
  _toSVG() {
    const { x1, x2, y1, y2 } = this.calcLinePoints();
    return [
      '<line ',
      'COMMON_PARTS',
      `x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />\n`,
    ];
  }

  /**
   * List of attribute names to account for when parsing SVG element (used by {@link Line.fromElement})
   * @see http://www.w3.org/TR/SVG/shapes.html#LineElement
   */
  static ATTRIBUTE_NAMES = SHARED_ATTRIBUTES.concat(coordProps);

  /**
   * Returns Line instance from an SVG element
   * @param {HTMLElement} element Element to parse
   * @param {Object} [options] Options object
   * @param {Function} [callback] callback function invoked after parsing
   */
  static async fromElement(
    element: HTMLElement,
    options?: Abortable,
    cssRules?: CSSRules,
  ) {
    const {
      x1 = 0,
      y1 = 0,
      x2 = 0,
      y2 = 0,
      ...parsedAttributes
    } = parseAttributes(element, this.ATTRIBUTE_NAMES, cssRules);
    return new this([x1, y1, x2, y2], parsedAttributes);
  }

  /* _FROM_SVG_END_ */

  /**
   * Returns Line instance from an object representation
   * @param {Object} object Object to create an instance from
   * @returns {Promise<Line>}
   */
  static fromObject<T extends TOptions<SerializedLineProps>>({
    x1,
    y1,
    x2,
    y2,
    ...object
  }: T) {
    return this._fromObject<Line>(
      {
        ...object,
        points: [x1, y1, x2, y2],
      },
      {
        extraParam: 'points',
      },
    );
  }
}

classRegistry.setClass(Line);
classRegistry.setSVGClass(Line);
