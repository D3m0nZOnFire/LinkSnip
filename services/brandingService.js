const fs = require('fs');
const path = require('path');
const paths = require('../config/paths');
const configService = require('./configService');
const paletteService = require('./paletteService');

/**
 * The site's identity (Admin → Appearance): name and tagline (settings.json), logo and favicon
 * (DATA_DIR/branding/logo.<ext>, favicon.<ext>), and the palettes (paletteService).
 */

const MAX_BYTES = 1024 * 1024;
const DEFAULT_LOGO = '/logo.png';
const ASSETS = {
  logo: ['png', 'jpg', 'webp', 'svg'],
  favicon: ['png', 'jpg', 'webp', 'svg', 'ico']
};
const CONTENT_TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon' };
const ALL_EXTENSIONS = Object.keys(CONTENT_TYPES);

class BrandingError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'BrandingError';
    this.status = status;
  }
}

const isAsset = (name) => Object.prototype.hasOwnProperty.call(ASSETS, name);

// The file type from its first bytes; the name and the browser's claim don't count
function sniff(data) {
  const starts = (bytes, at = 0) => bytes.every((b, i) => data[at + i] === b);
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (starts([0xff, 0xd8, 0xff])) return 'jpg';
  if (data.length >= 12 && data.toString('latin1', 0, 4) === 'RIFF' && data.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (starts([0x00, 0x00, 0x01, 0x00])) return 'ico';
  const text = data.toString('utf8', 0, Math.min(data.length, 4096)).replace(/^﻿/, '').trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(text)) return 'svg';
  return null;
}

// Shown in an <img> an SVG can't run anything, but opened on its own it could: no scripts at all
function svgHasScripts(data) {
  const text = data.toString('utf8');
  return /<script[\s>]/i.test(text) || /\son[a-z]+\s*=/i.test(text) || /javascript:/i.test(text) || /<foreignObject[\s>]/i.test(text);
}

// Every page asks for the logo and favicon: list the folder again only when it changed (one stat per request)
let listing = { stamp: null, files: [] };
function brandingFiles() {
  let stamp;
  try {
    stamp = fs.statSync(paths.BRANDING_DIR).mtimeMs;
  } catch (_) {
    return [];
  }
  if (listing.stamp !== stamp) {
    const files = fs.readdirSync(paths.BRANDING_DIR).map(f => {
      const full = path.join(paths.BRANDING_DIR, f);
      return { file: full, base: f, version: Math.round(fs.statSync(full).mtimeMs) };
    });
    listing = { stamp, files };
  }
  return listing.files;
}

function filesOf(name) {
  const wanted = new Set(ALL_EXTENSIONS.map(ext => `${name}.${ext}`));
  return brandingFiles().filter(f => wanted.has(f.base));
}

/**
 * @param {'logo'|'favicon'} name
 * @param {Buffer} data
 * @returns {{ type: string, size: number }}
 * @throws {BrandingError}
 */
function saveAsset(name, data) {
  if (!isAsset(name)) throw new BrandingError(`Unknown image "${name}"`, 404);
  if (data.length > MAX_BYTES) throw new BrandingError('The image is larger than 1 MB.', 413);
  const type = sniff(data);
  if (!type || !ASSETS[name].includes(type)) {
    throw new BrandingError(name === 'favicon'
      ? 'Use a PNG, JPG, WebP, SVG or ICO image.'
      : 'Use a PNG, JPG, WebP or SVG image.');
  }
  if (type === 'svg' && svgHasScripts(data)) throw new BrandingError('SVG images with scripts or event handlers are not allowed.');

  fs.mkdirSync(paths.BRANDING_DIR, { recursive: true });
  const target = path.join(paths.BRANDING_DIR, `${name}.${type}`);
  const temp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temp, data);
  fs.renameSync(temp, target);
  for (const old of filesOf(name)) if (old.file !== target) fs.rmSync(old.file, { force: true });
  listing = { stamp: null, files: [] }; // the folder's mtime may not change within the same millisecond
  return { type, size: data.length };
}

/** @returns {{ path, contentType, version } | null} */
function assetFile(name) {
  if (!isAsset(name)) return null;
  const [found] = filesOf(name);
  if (!found) return null;
  const ext = path.extname(found.file).slice(1);
  return { path: found.file, contentType: CONTENT_TYPES[ext], version: found.version };
}

/** @returns {boolean} whether there was one */
function deleteAsset(name) {
  const files = isAsset(name) ? filesOf(name) : [];
  files.forEach(f => fs.rmSync(f.file, { force: true }));
  listing = { stamp: null, files: [] };
  return files.length > 0;
}

function assetUrl(name) {
  const file = assetFile(name);
  return file ? `/branding/${name}?v=${file.version}` : null;
}

/**
 * For every view (res.locals.branding): read per request, so changes apply at once.
 * @returns {{ name, tagline, logoUrl, faviconUrl, themeUrl }}
 */
function locals() {
  const logoUrl = assetUrl('logo') || DEFAULT_LOGO;
  return {
    name: configService.get('branding.name').trim(),
    tagline: configService.get('branding.tagline').trim(),
    logoUrl,
    faviconUrl: assetUrl('favicon') || logoUrl,
    themeUrl: `/theme.css?v=${paletteService.themeCss().hash}`
  };
}

module.exports = { saveAsset, assetFile, deleteAsset, assetUrl, locals, BrandingError, MAX_BYTES, DEFAULT_LOGO, ASSETS };
