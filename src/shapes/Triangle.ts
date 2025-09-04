import { classRegistry } from '../ClassRegistry';
import { FabricObject, cacheProperties } from './Object/FabricObject';
import type { FabricObjectProps, SerializedObjectProps } from './Object/types';
import type { TClassProperties, TOptions } from '../typedefs';
import type { ObjectEvents } from '../EventTypeDefs';
import {
  applyCornerRadiusToPolygon,
  renderRoundedPolygon,
  generateRoundedPolygonPath,
} from '../util/misc/cornerRadius';

export const triangleDefaultValues: Partial<TClassProperties<Triangle>> = {
  width: 100,
  height: 100,
  cornerRadius: 0,
};

interface UniqueTriangleProps {
  cornerRadius: number;
}

export interface SerializedTriangleProps
  extends SerializedObjectProps,
    UniqueTriangleProps {}

export interface TriangleProps extends FabricObjectProps, UniqueTriangleProps {}

const TRIANGLE_PROPS = ['cornerRadius'] as const;

export class Triangle<
    Props extends TOptions<TriangleProps> = Partial<TriangleProps>,
    SProps extends SerializedTriangleProps = SerializedTriangleProps,
    EventSpec extends ObjectEvents = ObjectEvents,
  >
  extends FabricObject<Props, SProps, EventSpec>
  implements TriangleProps
{
  /**
   * Corner radius for rounded triangle corners
   * @type Number
   */
  declare cornerRadius: number;

  static type = 'Triangle';

  static cacheProperties = [...cacheProperties, ...TRIANGLE_PROPS];

  static ownDefaults = triangleDefaultValues;

  static getDefaults(): Record<string, any> {
    return { ...super.getDefaults(), ...Triangle.ownDefaults };
  }

  /**
   * Constructor
   * @param {Object} [options] Options object
   */
  constructor(options?: Props) {
    super();
    Object.assign(this, Triangle.ownDefaults);
    this.setOptions(options);
  }

  /**
   * Get triangle points as an array of XY coordinates
   * @private
   */
  private _getTrianglePoints() {
    const widthBy2 = this.width / 2;
    const heightBy2 = this.height / 2;

    return [
      { x: -widthBy2, y: heightBy2 }, // bottom left
      { x: 0, y: -heightBy2 }, // top center
      { x: widthBy2, y: heightBy2 }, // bottom right
    ];
  }

  /**
   * @private
   * @param {CanvasRenderingContext2D} ctx Context to render on
   */
  _render(ctx: CanvasRenderingContext2D) {
    if (this.cornerRadius > 0) {
      // Render rounded triangle
      const points = this._getTrianglePoints();
      const roundedCorners = applyCornerRadiusToPolygon(points, this.cornerRadius);
      renderRoundedPolygon(ctx, roundedCorners, true);
    } else {
      // Render sharp triangle (original implementation)
      const widthBy2 = this.width / 2;
      const heightBy2 = this.height / 2;

      ctx.beginPath();
      ctx.moveTo(-widthBy2, heightBy2);
      ctx.lineTo(0, -heightBy2);
      ctx.lineTo(widthBy2, heightBy2);
      ctx.closePath();
    }

    this._renderPaintInOrder(ctx);
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
    return super.toObject([...TRIANGLE_PROPS, ...propertiesToInclude]);
  }

  /**
   * Returns svg representation of an instance
   * @return {Array} an array of strings with the specific svg representation
   * of the instance
   */
  _toSVG() {
    if (this.cornerRadius > 0) {
      // Generate rounded triangle as path
      const points = this._getTrianglePoints();
      const roundedCorners = applyCornerRadiusToPolygon(points, this.cornerRadius);
      const pathData = generateRoundedPolygonPath(roundedCorners, true);
      return ['<path ', 'COMMON_PARTS', `d="${pathData}" />`];
    } else {
      // Original sharp triangle implementation
      const widthBy2 = this.width / 2;
      const heightBy2 = this.height / 2;
      const points = `${-widthBy2} ${heightBy2},0 ${-heightBy2},${widthBy2} ${heightBy2}`;
      return ['<polygon ', 'COMMON_PARTS', 'points="', points, '" />'];
    }
  }
}

classRegistry.setClass(Triangle);
classRegistry.setSVGClass(Triangle);
