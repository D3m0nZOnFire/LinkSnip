const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parse: parseToml } = require('smol-toml');
const configService = require('./configService');
const color = require('./color');

/**
 * Color palettes, in Omarchy's colors.toml format (https://github.com/omacom/omarchy, themes/<name>/colors.toml):
 * `mode`, `accent`, `background`, `foreground`, `red`, `yellow` (other keys are ignored), plus an optional `name`.
 *
 * Built in: LinkSnip Dark/Light (config/palettes) and every Omarchy theme (config/palettes/omarchy).
 * The host picks one dark and one light palette (branding.darkPalette / branding.lightPalette); themeCss() turns
 * them into the color variables of /theme.css. Everything else in the CSS derives from those variables.
 */

const BUILT_IN_DIRS = [path.join(__dirname, '../config/palettes'), path.join(__dirname, '../config/palettes/omarchy')];
const DEFAULTS = { dark: 'linksnip-dark', light: 'linksnip-light' };
const COLOR_KEYS = ['accent', 'background', 'foreground', 'red', 'yellow'];
const NAMES = { 'rose-pine': 'Rosé Pine' }; // where title case isn't the theme's real name

class PaletteError extends Error {
  constructor(errors) {
    super(errors.join('; '));
    this.name = 'PaletteError';
    this.errors = errors;
  }
}

const titleCase = (id) => id.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

/**
 * @param {string} text - colors.toml contents
 * @param {{ id: string, builtIn?: boolean }} options
 * @returns {{ id, name, mode, builtIn, colors: { accent, background, foreground, red, yellow } }}
 * @throws {PaletteError} naming every problem
 */
function parsePalette(text, { id, builtIn = false }) {
  let data;
  try {
    data = parseToml(text);
  } catch (error) {
    throw new PaletteError([`not valid TOML: ${error.message.split('\n')[0]}`]);
  }

  const errors = [];
  if (data.mode !== 'dark' && data.mode !== 'light') {
    errors.push(data.mode === undefined ? 'mode is missing' : `mode must be "dark" or "light" (got ${JSON.stringify(data.mode)})`);
  }
  const colors = {};
  for (const key of COLOR_KEYS) {
    if (data[key] === undefined) errors.push(`${key} is missing`);
    else if (!color.parse(data[key])) errors.push(`${key} must be a color like #1a2b3c (got ${JSON.stringify(data[key])})`);
    else colors[key] = color.normalize(data[key]);
  }
  if (data.name !== undefined && (typeof data.name !== 'string' || !data.name.trim())) errors.push('name must be text');
  if (errors.length) throw new PaletteError(errors);

  return { id, name: data.name ? data.name.trim() : (NAMES[id] || titleCase(id)), mode: data.mode, builtIn, colors };
}

function loadBuiltIns() {
  const palettes = new Map();
  for (const dir of BUILT_IN_DIRS) {
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.toml')).sort()) {
      const id = file.replace(/\.toml$/, '');
      palettes.set(id, parsePalette(fs.readFileSync(path.join(dir, file), 'utf8'), { id, builtIn: true }));
    }
  }
  return palettes;
}
const builtIns = loadBuiltIns();

function getPalette(id) {
  return builtIns.get(id) || null;
}

/** LinkSnip's own first, then by name */
function listPalettes(mode) {
  const all = [...builtIns.values()].filter(p => !mode || p.mode === mode);
  const own = (p) => (p.id === DEFAULTS[p.mode] ? 0 : 1);
  return all.sort((a, b) => own(a) - own(b) || a.name.localeCompare(b.name));
}

/** null when `id` is a palette of that mode, else what's wrong (for the Appearance form) */
function checkChoice(mode, id) {
  const palette = getPalette(id);
  if (!palette) return `There is no palette "${id}".`;
  if (palette.mode !== mode) return `"${palette.name}" is a ${palette.mode} palette.`;
  return null;
}

// ─── Palette → CSS variables ──────────────────────────────────────────────────

// Is the theme's "red" actually red, its "yellow" warm? Some themes use other hues there (Lumon's red is blue,
// Hackerman's green), but delete buttons and errors must look dangerous.
const isRed = (hex) => { const { h, s } = color.hsl(hex); return s >= 0.3 && (h >= 340 || h <= 15); };
const isWarm = (hex) => { const { h, s } = color.hsl(hex); return s >= 0.3 && h >= 20 && h <= 65; };

// Readable on every one of `backgrounds`
function readable(hex, backgrounds, ratio) {
  return backgrounds.reduce((c, bg) => color.ensureContrast(c, bg, ratio), hex);
}

/**
 * The theme colors for one palette, as CSS variables. Background, foreground and accent come from the palette;
 * surfaces (cards, borders, hover) are mixed from background and foreground, since themes name their extra shades
 * differently. Text colors are nudged (same hue, other lightness) only where they wouldn't read.
 */
function tokens(palette) {
  const dark = palette.mode === 'dark';
  const fallback = builtIns.get(DEFAULTS[palette.mode]).colors;
  const { background: bg, accent } = palette.colors;
  const between = (share) => color.mix(bg, palette.colors.foreground, share);

  const card = dark ? between(0.04) : color.mix(bg, '#ffffff', 0.6);
  const surfaces = [bg, card];
  const fg = readable(palette.colors.foreground, surfaces, 7);
  const primary = readable(accent, surfaces, 4.5);
  const destructive = readable(isRed(palette.colors.red) ? palette.colors.red : fallback.red, surfaces, 4.5);
  const warning = readable(isWarm(palette.colors.yellow) ? palette.colors.yellow : fallback.yellow, surfaces, 4.5);

  return {
    '--background': bg,
    '--foreground': fg,
    '--card': card,
    '--card-foreground': fg,
    '--secondary': between(dark ? 0.08 : 0.05),
    '--secondary-foreground': fg,
    '--muted': between(dark ? 0.14 : 0.1),
    '--muted-foreground': readable(between(dark ? 0.62 : 0.6), surfaces, 4.5),
    '--border': between(dark ? 0.14 : 0.12),
    '--border-hover': between(dark ? 0.24 : 0.22),
    '--input': dark ? between(0.06) : card,
    '--primary': primary,
    // Both were made to read on the background, so the background reads on them
    '--primary-foreground': bg,
    '--ring': primary,
    '--destructive': destructive,
    '--destructive-foreground': bg,
    '--warning': warning
  };
}

// ─── /theme.css ───────────────────────────────────────────────────────────────

const warned = new Set();
function resolve(id, mode) {
  const palette = getPalette(id);
  if (palette && palette.mode === mode) return palette;
  const key = `${mode}:${id}`;
  if (!warned.has(key)) {
    warned.add(key);
    console.warn(`settings.json: branding.${mode}Palette "${id}" is not a ${mode} palette; using ${DEFAULTS[mode]}`);
  }
  return getPalette(DEFAULTS[mode]);
}

const block = (selector, vars) => `${selector} {\n${Object.entries(vars).map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n}\n`;

const cache = new Map();
/**
 * CSS for the chosen palettes (the settings unless given) and a short hash of it for cache busting.
 * @param {{ dark?: string, light?: string }} [choice]
 * @returns {{ css: string, hash: string }}
 */
function themeCss(choice = {}) {
  const dark = resolve(choice.dark || configService.get('branding.darkPalette'), 'dark');
  const light = resolve(choice.light || configService.get('branding.lightPalette'), 'light');
  const key = JSON.stringify([dark, light]);
  if (!cache.has(key)) {
    const css = `/* Palettes: ${dark.name} (dark), ${light.name} (light). Generated; choose them in Admin → Appearance. */\n`
      + block(':root', tokens(dark))
      + block('html[data-theme="light"]', tokens(light));
    cache.set(key, { css, hash: crypto.createHash('sha256').update(css).digest('hex').slice(0, 12) });
  }
  return cache.get(key);
}

module.exports = { parsePalette, getPalette, listPalettes, checkChoice, tokens, themeCss, PaletteError, DEFAULTS };
