import {
  pointDistance,
  normalizeVector,
  angleBetweenVectors,
  getMaxRadius,
  calculateRoundedCorner,
  applyCornerRadiusToPolygon,
  generateRoundedPolygonPath,
} from './cornerRadius';

describe('cornerRadius utilities', () => {
  describe('pointDistance', () => {
    it('should calculate distance between two points correctly', () => {
      expect(pointDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
      expect(pointDistance({ x: 1, y: 1 }, { x: 1, y: 1 })).toBe(0);
      expect(pointDistance({ x: 0, y: 0 }, { x: 1, y: 0 })).toBe(1);
    });
  });

  describe('normalizeVector', () => {
    it('should normalize vectors correctly', () => {
      const result = normalizeVector({ x: 3, y: 4 });
      expect(result.x).toBeCloseTo(0.6);
      expect(result.y).toBeCloseTo(0.8);
    });

    it('should handle zero vector', () => {
      const result = normalizeVector({ x: 0, y: 0 });
      expect(result).toEqual({ x: 0, y: 0 });
    });
  });

  describe('getMaxRadius', () => {
    it('should return half of the shortest adjacent edge', () => {
      const prevPoint = { x: 0, y: 0 };
      const currentPoint = { x: 10, y: 0 };
      const nextPoint = { x: 10, y: 5 };
      
      expect(getMaxRadius(prevPoint, currentPoint, nextPoint)).toBe(2.5);
    });
  });

  describe('calculateRoundedCorner', () => {
    it('should calculate rounded corner data correctly', () => {
      const prevPoint = { x: 0, y: 0 };
      const currentPoint = { x: 10, y: 0 };
      const nextPoint = { x: 10, y: 10 };
      const radius = 2;

      const result = calculateRoundedCorner(prevPoint, currentPoint, nextPoint, radius);
      
      expect(result.corner).toEqual(currentPoint);
      expect(result.actualRadius).toBe(radius);
      expect(result.start.x).toBeCloseTo(8);
      expect(result.start.y).toBeCloseTo(0);
      expect(result.end.x).toBeCloseTo(10);
      expect(result.end.y).toBeCloseTo(2);
    });

    it('should constrain radius to maximum allowed', () => {
      const prevPoint = { x: 0, y: 0 };
      const currentPoint = { x: 2, y: 0 };
      const nextPoint = { x: 2, y: 2 };
      const radius = 5; // Request larger radius than possible

      const result = calculateRoundedCorner(prevPoint, currentPoint, nextPoint, radius);
      
      expect(result.actualRadius).toBe(1); // Should be constrained to 1
    });
  });

  describe('applyCornerRadiusToPolygon', () => {
    it('should apply corner radius to a simple triangle', () => {
      const points = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 5, y: 10 }
      ];
      const radius = 2;

      const result = applyCornerRadiusToPolygon(points, radius);
      
      expect(result).toHaveLength(3);
      expect(result[0].actualRadius).toBeCloseTo(2);
      expect(result[1].actualRadius).toBeCloseTo(2);
      expect(result[2].actualRadius).toBeCloseTo(2);
    });

    it('should handle percentage-based radius', () => {
      const points = [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 }
      ];
      const radius = 10; // 10%

      const result = applyCornerRadiusToPolygon(points, radius, true);
      
      expect(result).toHaveLength(4);
      expect(result[0].actualRadius).toBeCloseTo(10); // 10% of 100px = 10px
    });

    it('should throw error for polygons with less than 3 points', () => {
      expect(() => {
        applyCornerRadiusToPolygon([{ x: 0, y: 0 }, { x: 1, y: 1 }], 5);
      }).toThrow('Polygon must have at least 3 points');
    });
  });

  describe('generateRoundedPolygonPath', () => {
    it('should generate valid SVG path data', () => {
      const points = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 5, y: 10 }
      ];
      const roundedCorners = applyCornerRadiusToPolygon(points, 2);
      
      const pathData = generateRoundedPolygonPath(roundedCorners, true);
      
      expect(pathData).toContain('M '); // Should start with move command
      expect(pathData).toContain('C '); // Should contain bezier curve commands  
      expect(pathData).toContain('L '); // Should contain line commands
      expect(pathData).toContain('Z');  // Should end with close command for closed path
    });

    it('should generate open path when closed=false', () => {
      const points = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 5, y: 10 }
      ];
      const roundedCorners = applyCornerRadiusToPolygon(points, 2);
      
      const pathData = generateRoundedPolygonPath(roundedCorners, false);
      
      expect(pathData).not.toContain('Z'); // Should not end with close command
    });
  });
});