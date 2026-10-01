const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parse: parseToml, stringify: stringifyToml } = require('smol-toml');
const paths = require('../config/paths');
const configService = require('./configService');
const color = require('./color');

/**
 * Color palettes, in Omarchy's colors.toml format (https://github.com/omacom/omarchy, themes/<name>/colors.toml):
 * `mode`, `accent`, `background`, `foreground`, `red`, `yellow` (other keys are ignored), plus an optional `name`.
 *
 * Built in: LinkSnip Dark/Light (config/palettes) and every Omarchy theme (config/palettes/omarchy).
 * Custom: DATA_DIR/palettes/<id>.toml, made in Admin → Appearance or dropped in by hand (re-read every few seconds,
 * like settings.json; a broken file is skipped and reported by problems()).
 * The host picks one dark and one light palette (branding.darkPalette / branding.lightPalette); themeCss() turns
 * them into the color variables of /theme.css. Everything else in the CSS derives from those variables.
 */

const BUILT_IN_DIRS = [path.join(__dirname, '../config/palettes'), path.join(__dirname, '../config/palettes/omarchy')];
const DEFAULTS = { dark: 'linksnip-dark', light: 'linksnip-light' };
const COLOR_KEYS = ['accent', 'background', 'foreground', 'red', 'yellow'];
const NAMES = { 'rose-pine': 'Rosé Pine' }; // where title case isn't the theme's real name
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_NAME = 40;
const RESCAN_MS = 2000;

class PaletteError extends Error {
  constructor(errors, status = 400) {
    const list = Array.isArray(errors) ? errors : [errors];
    super(list.join('; '));
    this.name = 'PaletteError';
    this.errors = list;
    this.status = status;
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

  const { errors, mode, colors } = checkFields(data);
  if (data.name !== undefined && (typeof data.name !== 'string' || !data.name.trim())) errors.push('name must be text');
  if (errors.length) throw new PaletteError(errors);

  return { id, name: data.name ? data.name.trim() : (NAMES[id] || titleCase(id)), mode, builtIn, colors };
}

// mode and the five colors, normalized; every problem in `errors`
function checkFields(data) {
  const errors = [];
  if (data.mode !== 'dark' && data.mode !== 'light') {
    errors.push(data.mode === undefined ? 'mode is missing' : `mode must be "dark" or "light" (got ${JSON.stringify(data.mode)})`);
  }
  const colors = {};
  for (const key of COLOR_KEYS) {
    if (data[key] === undefined || data[key] === null || data[key] === '') errors.push(`${key} is missing`);
    else if (!color.parse(data[key])) errors.push(`${key} must be a color like #1a2b3c (got ${JSON.stringify(data[key])})`);
    else colors[key] = color.normalize(data[key]);
  }
  return { errors, mode: data.mode, colors };
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

// ─── Custom palettes (DATA_DIR/palettes) ──────────────────────────────────────

let custom = { scannedAt: 0, signature: null, palettes: new Map(), problems: [] };
const warnedFiles = new Set();

function scan() {
  let entries = [];
  try {
    entries = fs.readdirSync(paths.PALETTES_DIR).filter(f => f.endsWith('.toml')).sort().map(file => {
      const stat = fs.statSync(path.join(paths.PALETTES_DIR, file));
      return { file, stamp: `${file}:${stat.mtimeMs}:${stat.size}` };
    });
  } catch (_) { /* no folder: no custom palettes */ }

  const signature = entries.map(e => e.stamp).join('|');
  if (signature === custom.signature) {
    custom.scannedAt = Date.now();
    return;
  }
  const palettes = new Map();
  const problems = [];
  for (const { file, stamp } of entries) {
    const id = file.replace(/\.toml$/, '');
    let errors;
    if (!ID_PATTERN.test(id)) errors = ['file name must be lowercase letters, digits and dashes, like company-blue.toml'];
    else if (builtIns.has(id)) errors = ['has the same name as a built-in palette; rename the file'];
    else {
      try {
        palettes.set(id, parsePalette(fs.readFileSync(path.join(paths.PALETTES_DIR, file), 'utf8'), { id }));
      } catch (error) {
        errors = error instanceof PaletteError ? error.errors : [error.message];
      }
    }
    if (errors) {
      problems.push({ file, errors });
      if (!warnedFiles.has(stamp)) {
        warnedFiles.add(stamp);
        console.warn(`palettes/${file}: ${errors.join('; ')} (skipped)`);
      }
    }
  }
  custom = { scannedAt: Date.now(), signature, palettes, problems };
}

function fresh() {
  if (Date.now() - custom.scannedAt >= RESCAN_MS) scan();
  return custom;
}

/** Read DATA_DIR/palettes again now (after writing to it; tests) */
function reload() {
  custom.signature = null;
  scan();
}

/** Palette files that couldn't be used: [{ file, errors }] */
function problems() {
  return fresh().problems;
}

function getPalette(id) {
  return builtIns.get(id) || fresh().palettes.get(id) || null;
}

/** LinkSnip's own first, then by name */
function listPalettes(mode, { builtInOnly = false } = {}) {
  const all = [...builtIns.values(), ...(builtInOnly ? [] : fresh().palettes.values())].filter(p => !mode || p.mode === mode);
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
function derive(palette) {
  const dark = palette.mode === 'dark';
  const fallback = builtIns.get(DEFAULTS[palette.mode]).colors;
  const { background: bg, accent } = palette.colors;
  const between = (share) => color.mix(bg, palette.colors.foreground, share);
  const notes = [];
  const shade = dark ? 'lighter' : 'darker';
  const hard = dark ? 'too dark' : 'too light';
  const note = (key, to, message) => { if (to !== palette.colors[key]) notes.push({ key, from: palette.colors[key], to, message }); };

  const card = dark ? between(0.04) : color.mix(bg, '#ffffff', 0.6);
  const surfaces = [bg, card];
  const fg = readable(palette.colors.foreground, surfaces, 7);
  note('foreground', fg, `Foreground is ${hard} to read on the background; text uses a ${shade} shade.`);
  const primary = readable(accent, surfaces, 4.5);
  note('accent', primary, `Accent is ${hard} to read on the background; links and buttons use a ${shade} shade.`);

  let destructive;
  if (isRed(palette.colors.red)) {
    destructive = readable(palette.colors.red, surfaces, 4.5);
    note('red', destructive, `Red is ${hard} to read on the background; a ${shade} shade is used.`);
  } else {
    destructive = readable(fallback.red, surfaces, 4.5);
    note('red', destructive, "Red is not a red, so delete buttons and errors use LinkSnip's red.");
  }
  let warning;
  if (isWarm(palette.colors.yellow)) {
    warning = readable(palette.colors.yellow, surfaces, 4.5);
    note('yellow', warning, `Yellow is ${hard} to read on the background; a ${shade} shade is used.`);
  } else {
    warning = readable(fallback.yellow, surfaces, 4.5);
    note('yellow', warning, "Yellow is not a warm color, so warnings use LinkSnip's amber.");
  }

  const tokens = {
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
  return { tokens, notes };
}

function tokens(palette) {
  return derive(palette).tokens;
}

/**
 * What tokens() changed and why, for the palette editor: [{ key, from, to, message }]
 * @param {{ mode, colors }} palette
 */
function report(palette) {
  return derive(palette).notes;
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
    if (cache.size > 50) cache.clear(); // edited custom palettes leave old entries behind
    const css = `/* Palettes: ${dark.name} (dark), ${light.name} (light). Generated; choose them in Admin → Appearance. */\n`
      + block(':root', tokens(dark))
      + block('html[data-theme="light"]', tokens(light));
    cache.set(key, { css, hash: crypto.createHash('sha256').update(css).digest('hex').slice(0, 12) });
  }
  return cache.get(key);
}

// ─── Editing custom palettes (Admin → Appearance) ─────────────────────────────

// { name, mode, colors } from the editor, checked; throws PaletteError (400) with every problem
function checkInput({ name, mode, colors } = {}) {
  const errors = [];
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed) errors.push('Name is required.');
  else if (trimmed.length > MAX_NAME) errors.push(`Name must be at most ${MAX_NAME} characters.`);
  const checked = checkFields({ mode, ...(colors && typeof colors === 'object' ? colors : {}) });
  errors.push(...checked.errors);
  if (errors.length) throw new PaletteError(errors);
  return { name: trimmed, mode, colors: checked.colors };
}

function writeFile(id, { name, mode, colors }) {
  fs.mkdirSync(paths.PALETTES_DIR, { recursive: true });
  const target = path.join(paths.PALETTES_DIR, `${id}.toml`);
  const text = '# LinkSnip palette (Omarchy colors.toml format). Edited in Admin → Appearance, or by hand.\n'
    + stringifyToml({ name, mode, ...colors }).trimEnd() + '\n';
  const temp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temp, text);
  fs.renameSync(temp, target);
  reload();
  return getPalette(id);
}

function customPalette(id) {
  if (builtIns.has(id)) throw new PaletteError("Built-in palettes can't be changed. Make a new one starting from it.", 403);
  const palette = fresh().palettes.get(id);
  if (!palette) throw new PaletteError(`There is no palette "${id}".`, 404);
  return palette;
}

// The mode this palette is chosen for, if any
function inUseAs(id) {
  if (configService.get('branding.darkPalette') === id) return 'dark';
  if (configService.get('branding.lightPalette') === id) return 'light';
  return null;
}

/** @returns the new palette; its id comes from the name (company-blue, company-blue-2, …) */
function createPalette(input) {
  const palette = checkInput(input);
  const base = palette.name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 56) || 'palette';
  let id = base;
  for (let n = 2; getPalette(id); n++) id = `${base}-${n}`;
  return writeFile(id, palette);
}

/** @returns the updated palette (same id) */
function updatePalette(id, input) {
  const existing = customPalette(id);
  const palette = checkInput(input);
  const usedAs = inUseAs(id);
  if (usedAs && palette.mode !== usedAs) {
    throw new PaletteError(`"${existing.name}" is the ${usedAs} palette in use; choose another ${usedAs} palette before changing its mode.`, 409);
  }
  return writeFile(id, palette);
}

function deletePalette(id) {
  const existing = customPalette(id);
  const usedAs = inUseAs(id);
  if (usedAs) throw new PaletteError(`"${existing.name}" is the ${usedAs} palette in use; choose another ${usedAs} palette first.`, 409);
  fs.rmSync(path.join(paths.PALETTES_DIR, `${id}.toml`), { force: true });
  reload();
  return existing;
}

module.exports = {
  parsePalette, getPalette, listPalettes, checkChoice, tokens, report, themeCss, reload, problems,
  createPalette, updatePalette, deletePalette, checkInput, PaletteError, DEFAULTS
};
