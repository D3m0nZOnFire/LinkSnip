const color = require('../../../services/color');

describe('services/color', () => {
  describe('parse / toHex', () => {
    it('reads #rrggbb and #rgb, any case', () => {
      expect(color.parse('#34D399')).toEqual({ r: 52, g: 211, b: 153 });
      expect(color.parse('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    });

    it('returns null for anything else', () => {
      for (const bad of ['34d399', '#12345', '#ggg', 'red', '', null, undefined, 42]) {
        expect(color.parse(bad)).toBeNull();
      }
    });

    it('writes lowercase #rrggbb', () => {
      expect(color.toHex({ r: 52, g: 211, b: 153 })).toBe('#34d399');
      expect(color.normalize('#FFF')).toBe('#ffffff');
    });
  });

  describe('mix', () => {
    it('blends the second color in by the given share', () => {
      expect(color.mix('#000000', '#ffffff', 0)).toBe('#000000');
      expect(color.mix('#000000', '#ffffff', 1)).toBe('#ffffff');
      expect(color.mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    });
  });

  describe('contrast (WCAG 2)', () => {
    it('is 21 for black on white and 1 for a color on itself', () => {
      expect(color.contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
      expect(color.contrast('#34d399', '#34d399')).toBeCloseTo(1, 5);
    });

    it('does not depend on the order', () => {
      expect(color.contrast('#047857', '#fafafa')).toBeCloseTo(color.contrast('#fafafa', '#047857'), 10);
    });
  });

  describe('ensureContrast', () => {
    it('leaves a color that already reads well alone', () => {
      expect(color.ensureContrast('#34d399', '#09090b', 4.5)).toBe('#34d399');
    });

    it('moves a dim color toward the side of the background with more room until it reads', () => {
      const out = color.ensureContrast('#78824b', '#222222', 4.5);
      expect(color.contrast(out, '#222222')).toBeGreaterThanOrEqual(4.5);
      expect(color.luminance(out)).toBeGreaterThan(color.luminance('#78824b')); // lightened on a dark background
    });

    it('keeps the hue (only lightness changes)', () => {
      const out = color.ensureContrast('#78824b', '#222222', 4.5);
      expect(Math.abs(color.hsl(out).h - color.hsl('#78824b').h)).toBeLessThan(4);
    });

    it('darkens on a light background', () => {
      const out = color.ensureContrast('#a0a0a0', '#ffffff', 4.5);
      expect(color.contrast(out, '#ffffff')).toBeGreaterThanOrEqual(4.5);
      expect(color.luminance(out)).toBeLessThan(color.luminance('#a0a0a0'));
    });
  });

  describe('readableOn', () => {
    it('picks whichever candidate reads best on the color', () => {
      expect(color.readableOn('#34d399', ['#09090b', '#fafafa'])).toBe('#09090b');
      expect(color.readableOn('#047857', ['#09090b', '#ffffff'])).toBe('#ffffff');
    });
  });

  describe('hsl', () => {
    it('gives hue in degrees and saturation/lightness from 0 to 1', () => {
      const { h, s, l } = color.hsl('#ff0000');
      expect(h).toBeCloseTo(0, 5);
      expect(s).toBeCloseTo(1, 5);
      expect(l).toBeCloseTo(0.5, 5);
      expect(color.hsl('#808080').s).toBe(0);
    });
  });
});
