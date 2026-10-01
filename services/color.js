/**
 * Small color helpers for palettes: hex parsing, mixing, WCAG 2 contrast, and nudging a color's
 * lightness until it reads on a background. Colors are '#rrggbb' strings in and out.
 */

function parse(hex) {
  if (typeof hex !== 'string') return null;
  let m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (m) {
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex);
  if (m) return { r: parseInt(m[1] + m[1], 16), g: parseInt(m[2] + m[2], 16), b: parseInt(m[3] + m[3], 16) };
  return null;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const toHex = ({ r, g, b }) => '#' + [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
const normalize = (hex) => toHex(parse(hex));

/** `b` blended into `a` by `share` (0 = a, 1 = b) */
function mix(a, b, share) {
  const x = parse(a);
  const y = parse(b);
  return toHex({ r: x.r + (y.r - x.r) * share, g: x.g + (y.g - x.g) * share, b: x.b + (y.b - x.b) * share });
}

function luminance(hex) {
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const { r, g, b } = parse(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function hsl(hex) {
  const { r, g, b } = parse(hex);
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === R) h = ((G - B) / d + (G < B ? 6 : 0));
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  return { h: h * 60, s, l };
}

function fromHsl({ h, s, l }) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return toHex({ r: f(0) * 255, g: f(8) * 255, b: f(4) * 255 });
}

/**
 * The color itself when it reaches `ratio` against `background`; otherwise the same hue made lighter
 * (dark backgrounds) or darker (light ones), step by step, until it does.
 */
function ensureContrast(hex, background, ratio) {
  const start = normalize(hex);
  if (contrast(start, background) >= ratio) return start;
  const lighten = contrast('#ffffff', background) >= contrast('#000000', background);
  const { h, s, l } = hsl(start);
  for (let step = 1; step <= 100; step++) {
    const next = fromHsl({ h, s, l: clamp(lighten ? l + step / 100 : l - step / 100, 0, 1) });
    if (contrast(next, background) >= ratio) return next;
  }
  return lighten ? '#ffffff' : '#000000';
}

/** The candidate with the most contrast on `background` */
function readableOn(background, candidates) {
  return candidates.reduce((best, c) => (contrast(c, background) > contrast(best, background) ? c : best));
}

module.exports = { parse, toHex, normalize, mix, luminance, contrast, hsl, fromHsl, ensureContrast, readableOn };
