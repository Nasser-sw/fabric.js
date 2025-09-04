import { Triangle } from './Triangle';

describe('Triangle with Corner Radius', () => {
  describe('constructor', () => {
    it('should create triangle with default cornerRadius of 0', () => {
      const triangle = new Triangle();
      expect(triangle.cornerRadius).toBe(0);
    });

    it('should create triangle with specified cornerRadius', () => {
      const triangle = new Triangle({ cornerRadius: 10 });
      expect(triangle.cornerRadius).toBe(10);
    });
  });

  describe('rendering', () => {
    let canvas: HTMLCanvasElement;
    let ctx: CanvasRenderingContext2D;

    beforeEach(() => {
      canvas = document.createElement('canvas');
      canvas.width = 200;
      canvas.height = 200;
      ctx = canvas.getContext('2d')!;
    });

    it('should render sharp triangle when cornerRadius is 0', () => {
      const triangle = new Triangle({ width: 100, height: 100, cornerRadius: 0 });
      const spy = jest.spyOn(ctx, 'moveTo');
      const lineSpy = jest.spyOn(ctx, 'lineTo');
      const bezierSpy = jest.spyOn(ctx, 'bezierCurveTo');

      triangle._render(ctx);

      expect(spy).toHaveBeenCalled();
      expect(lineSpy).toHaveBeenCalled();
      expect(bezierSpy).not.toHaveBeenCalled(); // No curves for sharp corners
    });

    it('should render rounded triangle when cornerRadius > 0', () => {
      const triangle = new Triangle({ width: 100, height: 100, cornerRadius: 10 });
      const bezierSpy = jest.spyOn(ctx, 'bezierCurveTo');

      triangle._render(ctx);

      expect(bezierSpy).toHaveBeenCalled(); // Should use curves for rounded corners
    });
  });

  describe('toObject', () => {
    it('should include cornerRadius in serialized object', () => {
      const triangle = new Triangle({ cornerRadius: 15 });
      const obj = triangle.toObject();
      
      expect(obj.cornerRadius).toBe(15);
    });
  });

  describe('_toSVG', () => {
    it('should generate polygon SVG for sharp triangle', () => {
      const triangle = new Triangle({ width: 100, height: 100, cornerRadius: 0 });
      const svg = triangle._toSVG();
      
      expect(svg.join('')).toContain('<polygon');
      expect(svg.join('')).toContain('points=');
    });

    it('should generate path SVG for rounded triangle', () => {
      const triangle = new Triangle({ width: 100, height: 100, cornerRadius: 10 });
      const svg = triangle._toSVG();
      
      expect(svg.join('')).toContain('<path');
      expect(svg.join('')).toContain('d=');
    });
  });
});