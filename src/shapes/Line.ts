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

const coordProps = ['x1', 'x2', 'y1', 'y2'] as const;

interface UniqueLineCoords {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}

export interface SerializedLineProps
  extends SerializedObjectProps,
    UniqueLineCoords {}

export class Line< 
    Props extends TOptions<FabricObjectProps> = Partial<FabricObjectProps>,
    SProps extends SerializedLineProps = SerializedLineProps,
    EventSpec extends ObjectEvents = ObjectEvents
  >
  extends FabricObject<Props, SProps, EventSpec>
  implements UniqueLineCoords
{
  declare x1: number;
  declare y1: number;
  declare x2: number;
  declare y2: number;

  hitStrokeWidth: number | 'auto' = 'auto';

  private _updatingEndpoints = false;
  private _useEndpointCoords = true;

  static type = 'Line';
  static cacheProperties = [...cacheProperties, ...coordProps];

  constructor([x1, y1, x2, y2] = [0, 0, 100, 0], options: Partial<Props & {hitStrokeWidth?: number | 'auto'}> = {}) {
    super();
    this.setOptions(options);
    this.x1 = x1;
    this.x2 = x2;
    this.y1 = y1;
    this.y2 = y2;

    if (options.hitStrokeWidth !== undefined) {
      this.hitStrokeWidth = options.hitStrokeWidth;
    }

    this.hasBorders = false;
    this.hasControls = true;
    this.selectable = true;
    this.hoverCursor = 'move';
    this.perPixelTargetFind = false;
    this.strokeLineCap = 'butt';

    this._setWidthHeight();
    const { left, top } = options;
    typeof left === 'number' && this.set(LEFT, left);
    typeof top === 'number' && this.set(TOP, top);
    this._setupLineControls();
  }

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

  _p1PositionHandler() {
    const vpt = this.canvas?.viewportTransform || [1, 0, 0, 1, 0, 0];
    return new Point(this.x1, this.y1).transform(vpt);
  }

  _p2PositionHandler() {
    const vpt = this.canvas?.viewportTransform || [1, 0, 0, 1, 0, 0];
    return new Point(this.x2, this.y2).transform(vpt);
  }

  _renderEndpointControl(
    ctx: CanvasRenderingContext2D,
    left: number,
    top: number
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

  drawBorders(ctx: CanvasRenderingContext2D, styleOverride: any = {}) {
    if (this._useEndpointCoords) {
      this._drawLineBorders(ctx, styleOverride);
      return this;
    }
    return super.drawBorders(ctx, styleOverride, {});
  }

  _drawLineBorders(ctx: CanvasRenderingContext2D, styleOverride: any = {}) {
    const vpt = this.canvas?.viewportTransform || [1, 0, 0, 1, 0, 0];
    ctx.save();
    ctx.setTransform(vpt[0], vpt[1], vpt[2], vpt[3], vpt[4], vpt[5]);
    ctx.strokeStyle =
      styleOverride.borderColor || this.borderColor || 'rgba(100, 200, 200, 0.5)';
    ctx.lineWidth = (this.strokeWidth || 1) + 5;
    ctx.lineCap = this.strokeLineCap || 'butt';
    ctx.globalAlpha = this.isMoving ? this.borderOpacityWhenMoving : 1;
    ctx.beginPath();
    ctx.moveTo(this.x1, this.y1);
    ctx.lineTo(this.x2, this.y2);
    ctx.stroke();
    ctx.restore();
  }

  _renderControls(ctx: CanvasRenderingContext2D, styleOverride: any = {}) {
    ctx.save();
    ctx.globalAlpha = this.isMoving ? this.borderOpacityWhenMoving : 1;
    this.drawControls(ctx, styleOverride);
    ctx.restore();
  }

  getBoundingRect() {
    if (this._useEndpointCoords) {
      const { x1, y1, x2, y2 } = this;
      const effectiveStrokeWidth =
        this.hitStrokeWidth === 'auto'
          ? this.strokeWidth
          : this.hitStrokeWidth;
      const padding = Math.max(effectiveStrokeWidth / 2 + 5, 10);
      return {
        left: Math.min(x1, x2) - padding,
        top: Math.min(y1, y2) - padding,
        width: Math.abs(x2 - x1) + padding * 2 || padding * 2,
        height: Math.abs(y2 - y1) + padding * 2 || padding * 2,
      };
    }
    return super.getBoundingRect();
  }

  setCoords() {
    if (this._useEndpointCoords) {
      const minX = Math.min(this.x1, this.x2);
      const maxX = Math.max(this.x1, this.x2);
      const minY = Math.min(this.y1, this.y2);
      const maxY = Math.max(this.y1, this.y2);
      const effectiveStrokeWidth =
        this.hitStrokeWidth === 'auto'
          ? this.strokeWidth
          : this.hitStrokeWidth;
      const hitPadding = Math.max(effectiveStrokeWidth / 2 + 5, 10);
      this.left = minX - hitPadding + (maxX - minX + hitPadding * 2) / 2;
      this.top = minY - hitPadding + (maxY - minY + hitPadding * 2) / 2;
      this.width = Math.abs(this.x2 - this.x1) + hitPadding * 2;
      this.height = Math.abs(this.y2 - this.y1) + hitPadding * 2;
    }
    super.setCoords();
  }

  getCoords(): [Point, Point, Point, Point] {
    if (this._useEndpointCoords) {
      const deltaX = this.x2 - this.x1;
      const deltaY = this.y2 - this.y1;
      const length = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      
      if (length === 0) {
        return super.getCoords() as [Point, Point, Point, Point];
      }
      
      const effectiveStrokeWidth = this.hitStrokeWidth === 'auto' 
        ? this.strokeWidth 
        : this.hitStrokeWidth;
      const halfWidth = Math.max(effectiveStrokeWidth / 2 + 2, 5);
      
      // Unit vector perpendicular to line
      const perpX = -deltaY / length;
      const perpY = deltaX / length;
      
      // Four corners of oriented rectangle
      return [
        new Point(this.x1 + perpX * halfWidth, this.y1 + perpY * halfWidth),
        new Point(this.x2 + perpX * halfWidth, this.y2 + perpY * halfWidth),
        new Point(this.x2 - perpX * halfWidth, this.y2 - perpY * halfWidth),
        new Point(this.x1 - perpX * halfWidth, this.y1 - perpY * halfWidth),
      ];
    }
    return super.getCoords() as [Point, Point, Point, Point];
  }

  containsPoint(point: Point): boolean {
    if (this._useEndpointCoords) {
      if (this.canvas?.getActiveObject() === this) {
        return super.containsPoint(point);
      }
      const distance = this._distanceToLineSegment(point.x, point.y);
      const effectiveStrokeWidth = this.hitStrokeWidth === 'auto' 
        ? this.strokeWidth 
        : this.hitStrokeWidth || 1;
      
      const tolerance = Math.max(effectiveStrokeWidth / 2 + 2, 5);
      return distance <= tolerance;
    }
    return super.containsPoint(point);
  }

  _distanceToLineSegment(px: number, py: number): number {
    const x1 = this.x1, y1 = this.y1, x2 = this.x2, y2 = this.y2;
    
    const pd2 = (x1 - x2) * (x1 - x2) + (y1 - y2) * (y1 - y2);
    if (pd2 === 0) {
      return Math.sqrt((px - x1) * (px - x1) + (py - y1) * (py - y1));
    }
    
    const u = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / pd2;
    
    let closestX: number, closestY: number;
    if (u < 0) {
      closestX = x1;
      closestY = y1;
    } else if (u > 1) {
      closestX = x2;
      closestY = y2;
    } else {
      closestX = x1 + u * (x2 - x1);
      closestY = y1 + u * (y2 - y1);
    }
    
    return Math.sqrt((px - closestX) * (px - closestX) + (py - closestY) * (py - closestY));
  }

  _endpointActionHandler(
    eventData: TPointerEvent,
    transformData: Transform,
    x: number,
    y: number
  ) {
    const controlKey = transformData.corner;
    const pointer = new Point(x, y);
    let newX = pointer.x;
    let newY = pointer.y;

    if (eventData.shiftKey) {
      const otherControl = controlKey === 'p1' ? 'p2' : 'p1';
      const otherX = this[otherControl === 'p1' ? 'x1' : 'x2'];
      const otherY = this[otherControl === 'p1' ? 'y1' : 'y2'];
      const snapped = this._snapToAngle(otherX, otherY, newX, newY);
      newX = snapped.x;
      newY = snapped.y;
    }

    if (this._useEndpointCoords) {
      if (controlKey === 'p1') {
        this.x1 = newX;
        this.y1 = newY;
      } else if (controlKey === 'p2') {
        this.x2 = newX;
        this.y2 = newY;
      }
      this.dirty = true;
      this.setCoords();
      this.canvas?.requestRenderAll();
      return true;
    }

    // Fallback for old system
    this._updatingEndpoints = true;
    if (controlKey === 'p1') {
      this.x1 = newX;
      this.y1 = newY;
    } else if (controlKey === 'p2') {
      this.x2 = newX;
      this.y2 = newY;
    }
    this._setWidthHeight();
    this.dirty = true;
    this._updatingEndpoints = false;
    this.canvas?.requestRenderAll();
    this.fire('modified', { transform: transformData, target: this, e: eventData });
    return true;
  }

  _snapToAngle(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number
  ): { x: number; y: number } {
    const deltaX = toX - fromX;
    const deltaY = toY - fromY;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    if (distance === 0) return { x: toX, y: toY };
    let angle = Math.atan2(deltaY, deltaX) * (180 / Math.PI);
    const snapIncrement = 15;
    const snappedAngle = Math.round(angle / snapIncrement) * snapIncrement;
    const snappedRadians = snappedAngle * (Math.PI / 180);
    return {
      x: fromX + Math.cos(snappedRadians) * distance,
      y: fromY + Math.sin(snappedRadians) * distance,
    };
  }

  _setWidthHeight(skipReposition = false) {
    this.width = Math.abs(this.x2 - this.x1) || 1;
    this.height = Math.abs(this.y2 - this.y1) || 1;
    if (!skipReposition && !this._updatingEndpoints) {
      const { left, top, width, height } = makeBoundingBoxFromPoints([
        { x: this.x1, y: this.y1 },
        { x: this.x2, y: this.y2 },
      ]);
      this.setPositionByOrigin(
        new Point(left + width / 2, top + height / 2),
        CENTER,
        CENTER
      );
    }
  }

  _set(key: string, value: any) {
    const oldLeft = this.left;
    const oldTop = this.top;
    super._set(key, value);
    if (coordProps.includes(key as keyof UniqueLineCoords)) {
      this._setWidthHeight();
      this.dirty = true;
    }
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

  render(ctx: CanvasRenderingContext2D) {
    if (this._useEndpointCoords) {
      this._renderDirectly(ctx);
      return;
    }
    super.render(ctx);
  }

  _renderDirectly(ctx: CanvasRenderingContext2D) {
    if (!this.visible) return;
    ctx.save();
    const vpt = this.canvas?.viewportTransform || [1, 0, 0, 1, 0, 0];
    ctx.transform(vpt[0], vpt[1], vpt[2], vpt[3], vpt[4], vpt[5]);
    ctx.globalAlpha = this.opacity;
    ctx.strokeStyle = this.stroke?.toString() || '#000';
    ctx.lineWidth = this.strokeWidth;
    ctx.lineCap = this.strokeLineCap || 'butt';
    ctx.beginPath();
    ctx.moveTo(this.x1, this.y1);
    ctx.lineTo(this.x2, this.y2);
    ctx.stroke();
    ctx.restore();
  }

  _render(ctx: CanvasRenderingContext2D) {
    if (this._useEndpointCoords) return;
    ctx.beginPath();
    const p = this.calcLinePoints();
    ctx.moveTo(p.x1, p.y1);
    ctx.lineTo(p.x2, p.y2);
    ctx.lineWidth = this.strokeWidth;
    const origStrokeStyle = ctx.strokeStyle;
    if (isFiller(this.stroke)) {
      ctx.strokeStyle = this.stroke.toLive(ctx)!;
    }
    this.stroke && this._renderStroke(ctx);
    ctx.strokeStyle = origStrokeStyle;
  }

  _findCenterFromElement(): Point {
    return new Point((this.x1 + this.x2) / 2, (this.y1 + this.y2) / 2);
  }

  toObject< 
    T extends Omit<Props & TClassProperties<this>, keyof SProps>,
    K extends keyof T = never
  >(propertiesToInclude: K[] = []): Pick<T, K> & SProps {
    return {
      ...super.toObject(propertiesToInclude),
      ...this.calcLinePoints(),
    };
  }

  _getNonTransformedDimensions(): Point {
    const dim = super._getNonTransformedDimensions();
    if (this.strokeLineCap === 'round') {
      dim.x += this.strokeWidth;
      dim.y += this.strokeWidth;
    }
    return dim;
  }

  calcLinePoints(): UniqueLineCoords {
    if (this._updatingEndpoints) {
      const centerX = (this.x1 + this.x2) / 2;
      const centerY = (this.y1 + this.y2) / 2;
      return {
        x1: this.x1 - centerX,
        y1: this.y1 - centerY,
        x2: this.x2 - centerX,
        y2: this.y2 - centerY,
      };
    }
    const { x1: _x1, x2: _x2, y1: _y1, y2: _y2, width, height } = this;
    const xMult = _x1 <= _x2 ? -1 : 1;
    const yMult = _y1 <= _y2 ? -1 : 1;
    return {
      x1: (xMult * width) / 2,
      y1: (yMult * height) / 2,
      x2: (xMult * -width) / 2,
      y2: (yMult * -height) / 2,
    };
  }

  _toSVG() {
    const { x1, x2, y1, y2 } = this.calcLinePoints();
    return [
      '<line ',
      'COMMON_PARTS',
      `x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />\n`,
    ];
  }

  static ATTRIBUTE_NAMES = SHARED_ATTRIBUTES.concat(coordProps);

  static async fromElement(
    element: HTMLElement,
    options?: Abortable,
    cssRules?: CSSRules
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

  static fromObject<T extends TOptions<SerializedLineProps>>({ 
    x1,
    y1,
    x2,
    y2,
    ...object
  }: T) {
    return this._fromObject<Line>(
      { ...object, points: [x1, y1, x2, y2] },
      { extraParam: 'points' }
    );
  }
}

classRegistry.setClass(Line);
classRegistry.setSVGClass(Line);