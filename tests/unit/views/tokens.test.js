const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../../..');
const CSS_DIR = path.join(ROOT, 'public/css');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const tokens = read('public/css/tokens.css');

// Body of the first rule whose selector list matches exactly
function block(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (css.match(new RegExp(`(^|[\\s}])${escaped}\\s*\\{([^}]*)\\}`)) || [])[2] || '';
}
const defines = (body) => new Set([...body.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m => m[1]));

// Every color the CSS and the views use; each theme sets them all
const THEME_COLORS = [
  '--background', '--foreground', '--card', '--card-foreground',
  '--primary', '--primary-foreground', '--secondary', '--secondary-foreground',
  '--muted', '--muted-foreground', '--destructive', '--destructive-foreground',
  '--border', '--input', '--ring', '--warning'
];

describe('public/css/tokens.css', () => {
  it('defines every theme color for dark (default) and light', () => {
    const dark = defines(block(tokens, ':root'));
    const light = defines(block(tokens, 'html[data-theme="light"]'));
    for (const name of THEME_COLORS) {
      expect(dark).toContain(name);
      expect(light).toContain(name);
    }
  });

  it('defines the spacing, radius, type and font scales', () => {
    const root = defines(block(tokens, ':root'));
    for (const name of ['--spacing-xs', '--spacing-md', '--spacing-3xl', '--radius-sm', '--radius-md', '--radius-lg',
      '--radius-full', '--text-xs', '--text-sm', '--text-base', '--text-lg', '--text-xl', '--text-2xl', '--text-3xl',
      '--font-sans', '--font-mono']) {
      expect(root).toContain(name);
    }
  });

  // A palette then only has to set --primary: tints follow it in both themes
  it('derives the accent tints from --primary instead of fixed values', () => {
    const root = block(tokens, ':root');
    for (const name of ['--status-active-bg', '--status-active-border', '--chart-background', '--chart-border',
      '--info-bg', '--info-border', '--focus-ring']) {
      const value = (root.match(new RegExp(`${name}\\s*:\\s*([^;]+);`)) || [])[1] || '';
      expect(value).toMatch(/var\(--primary\)/);
    }
  });

  it('serves Geist Sans and Geist Mono from the app itself', () => {
    const faces = [...tokens.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(m => m[1]);
    const families = faces.map(f => (f.match(/font-family:\s*'([^']+)'/) || [])[1]);
    expect(families).toEqual(expect.arrayContaining(['Geist', 'Geist Mono']));
    for (const face of faces) {
      const url = (face.match(/url\('([^']+)'\)/) || [])[1];
      expect(url).toMatch(/^\/fonts\//);
      expect(fs.existsSync(path.join(ROOT, 'public', url))).toBe(true);
      expect(face).toMatch(/font-display:\s*swap/);
    }
    expect(block(tokens, ':root')).toMatch(/--font-sans:\s*'Geist'/);
    expect(block(tokens, ':root')).toMatch(/--font-mono:\s*'Geist Mono'/);
  });

  it('ships the font license with the fonts', () => {
    expect(fs.existsSync(path.join(ROOT, 'public/fonts/OFL.txt'))).toBe(true);
  });
});

describe('no hardcoded accent outside tokens.css', () => {
  // The default accent (emerald) written out instead of var(--primary): a palette can't reach it
  const ACCENT = /rgba\(\s*(52,\s*211,\s*153|16,\s*185,\s*129)\s*,|#34d399|#10b981|#059669/i;
  const cssFiles = fs.readdirSync(CSS_DIR).filter(f => f.endsWith('.css') && f !== 'tokens.css' && f !== 'bio-page.css');
  const viewFiles = [];
  (function walk(dir) {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.ejs')) viewFiles.push(path.relative(ROOT, p));
    }
  })(path.join(ROOT, 'views'));

  it.each(cssFiles)('public/css/%s', (file) => {
    expect(read('public/css', file)).not.toMatch(ACCENT);
  });

  // Tag colors are user data (a hex the user picks), not theme colors: the tag form's
  // example placeholder is the one place a hex may show up
  it.each(viewFiles)('%s', (file) => {
    const html = read(file).replace(/placeholder="#[0-9a-f]{6}"/gi, '').replace(/like #[0-9a-f]{6}/gi, '');
    expect(html).not.toMatch(ACCENT);
  });

  // bio-page.css styles the themes a user picks for their own bio page; the rest
  // of the app takes its colors from tokens.css only
  it.each([...cssFiles, ...viewFiles.map(f => `../../${f}`)])('%s does not redefine theme colors', (file) => {
    const text = read('public/css', file);
    for (const name of THEME_COLORS) {
      expect(text).not.toMatch(new RegExp(`${name}\\s*:`));
    }
  });
});
