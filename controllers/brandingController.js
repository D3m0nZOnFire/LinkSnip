const path = require('path');
const multer = require('multer');
const paths = require('../config/paths');
const configService = require('../services/configService');
const { ConfigValidationError } = require('../services/configService');
const paletteService = require('../services/paletteService');
const brandingService = require('../services/brandingService');
const { BrandingError } = brandingService;
const { PaletteError } = paletteService;
const { logAdminAction, ACTIONS } = require('../services/auditService');

/**
 * Admin → Appearance: name, tagline, logo, favicon and the dark/light palettes, plus the public files they produce
 * (/theme.css, /branding/logo, /branding/favicon).
 */

const FIELDS = {
  name: 'branding.name',
  tagline: 'branding.tagline',
  darkPalette: 'branding.darkPalette',
  lightPalette: 'branding.lightPalette'
};
const LONG_CACHE = 'public, max-age=31536000, immutable';
const DEFAULT_LOGO_FILE = path.join(paths.PROJECT_ROOT, 'public', 'logo.png');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: brandingService.MAX_BYTES, files: 1 } }).single('file');

/**
 * GET /theme.css: the chosen palettes as CSS variables. Pages link it as /theme.css?v=<hash>, which never changes.
 */
exports.themeCss = (req, res) => {
  const { css, hash } = paletteService.themeCss();
  res.type('text/css');
  res.set('Cache-Control', req.query.v === hash ? LONG_CACHE : 'no-cache');
  res.send(css);
};

/**
 * GET /branding/logo | /branding/favicon: the uploaded image, else the logo, else LinkSnip's.
 */
exports.asset = (req, res, next) => {
  const name = req.params.asset;
  if (!Object.prototype.hasOwnProperty.call(brandingService.ASSETS, name)) return next();
  const file = brandingService.assetFile(name) || (name === 'favicon' && brandingService.assetFile('logo'));

  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Cache-Control', req.query.v ? LONG_CACHE : 'no-cache');
  if (!file) return res.type('image/png').sendFile(DEFAULT_LOGO_FILE);
  // Opened on its own, an SVG is a document: nothing in it may run or load
  if (file.contentType === 'image/svg+xml') {
    res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  }
  res.type(file.contentType).sendFile(file.path);
};

function pageData(user) {
  const withTokens = (p) => ({ ...p, tokens: paletteService.tokens(p) });
  return {
    user,
    palettes: {
      dark: paletteService.listPalettes('dark').map(withTokens),
      light: paletteService.listPalettes('light').map(withTokens)
    },
    problems: paletteService.problems(),
    palettesDir: paths.PALETTES_DIR,
    current: {
      name: configService.get('branding.name'),
      tagline: configService.get('branding.tagline'),
      darkPalette: configService.get('branding.darkPalette'),
      lightPalette: configService.get('branding.lightPalette'),
      logo: !!brandingService.assetFile('logo'),
      favicon: !!brandingService.assetFile('favicon')
    }
  };
}

/**
 * GET /admin/appearance
 */
exports.appearancePage = (req, res) => {
  res.render('admin-appearance', pageData(req.user));
};

/**
 * PUT /api/admin/appearance { name?, tagline?, darkPalette?, lightPalette? }: only what is sent changes.
 */
exports.updateAppearance = (req, res) => {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : null;
  if (!body) return res.status(400).json({ success: false, errors: ['Expected an object'] });

  const errors = [];
  const patch = {};
  for (const [field, value] of Object.entries(body)) {
    if (!FIELDS[field]) { errors.push(`Unknown field "${field}"`); continue; }
    patch[FIELDS[field]] = typeof value === 'string' ? value.trim() : value;
  }
  for (const mode of ['dark', 'light']) {
    const key = FIELDS[`${mode}Palette`];
    if (patch[key] === undefined) continue;
    const problem = paletteService.checkChoice(mode, patch[key]);
    if (problem) errors.push(`${mode === 'dark' ? 'Dark' : 'Light'} palette: ${problem}`);
  }
  if (errors.length) return res.status(400).json({ success: false, errors });

  let changed;
  try {
    changed = configService.updateSettings(patch);
  } catch (error) {
    if (error instanceof ConfigValidationError) return res.status(400).json({ success: false, errors: error.errors });
    console.error('Update appearance error:', error);
    return res.status(500).json({ success: false, errors: ['Could not save settings.json'] });
  }
  if (Object.keys(changed).length) {
    logAdminAction(ACTIONS.UPDATE_SETTINGS, req, 'settings', null, 'settings.json', changed);
  }
  res.json({ success: true, changed, themeUrl: brandingService.locals().themeUrl });
};

/**
 * POST /api/admin/branding/:asset (multipart, field "file")
 */
exports.uploadAsset = (req, res) => {
  const name = req.params.asset;
  if (!Object.prototype.hasOwnProperty.call(brandingService.ASSETS, name)) return res.status(404).json({ error: 'Not found' });

  upload(req, res, (err) => {
    if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'The image is larger than 1 MB.' });
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Choose an image to upload.' });

    let saved;
    try {
      saved = brandingService.saveAsset(name, req.file.buffer);
    } catch (error) {
      if (error instanceof BrandingError) return res.status(error.status).json({ error: error.message });
      console.error('Branding upload error:', error);
      return res.status(500).json({ error: 'Could not save the image.' });
    }
    logAdminAction(ACTIONS.UPDATE_BRANDING, req, 'branding', null, name, { asset: name, ...saved });
    res.json({ success: true, url: brandingService.assetUrl(name) });
  });
};

/**
 * DELETE /api/admin/branding/:asset: back to the default
 */
exports.deleteAsset = (req, res) => {
  const name = req.params.asset;
  if (!Object.prototype.hasOwnProperty.call(brandingService.ASSETS, name)) return res.status(404).json({ error: 'Not found' });
  if (brandingService.deleteAsset(name)) {
    logAdminAction(ACTIONS.UPDATE_BRANDING, req, 'branding', null, name, { asset: name, removed: true });
  }
  res.json({ success: true, url: brandingService.locals()[`${name}Url`] });
};

// ─── Custom palettes ──────────────────────────────────────────────────────────

const forPage = (p) => ({ ...p, tokens: paletteService.tokens(p) });

function paletteFailure(res, error, what) {
  if (error instanceof PaletteError) return res.status(error.status).json({ success: false, errors: error.errors });
  console.error(`${what} error:`, error);
  return res.status(500).json({ success: false, errors: ['Could not save the palette file.'] });
}

/**
 * POST /api/admin/palettes { name, mode, colors: { accent, background, foreground, red, yellow } }
 */
exports.createPalette = (req, res) => {
  let palette;
  try {
    palette = paletteService.createPalette(req.body || {});
  } catch (error) {
    return paletteFailure(res, error, 'Create palette');
  }
  logAdminAction(ACTIONS.CREATE_PALETTE, req, 'palette', null, palette.name, { id: palette.id, mode: palette.mode, colors: palette.colors });
  res.status(201).json({ success: true, palette: forPage(palette) });
};

/**
 * PUT /api/admin/palettes/:id (same body; custom palettes only)
 */
exports.updatePalette = (req, res) => {
  const before = paletteService.getPalette(req.params.id);
  let palette;
  try {
    palette = paletteService.updatePalette(req.params.id, req.body || {});
  } catch (error) {
    return paletteFailure(res, error, 'Update palette');
  }
  const flat = (p) => ({ name: p.name, mode: p.mode, ...p.colors });
  const changed = {};
  for (const [key, to] of Object.entries(flat(palette))) {
    const from = flat(before)[key];
    if (from !== to) changed[key] = { from, to };
  }
  if (Object.keys(changed).length) {
    logAdminAction(ACTIONS.UPDATE_PALETTE, req, 'palette', null, palette.name, { id: palette.id, changed });
  }
  res.json({ success: true, palette: forPage(palette) });
};

/**
 * DELETE /api/admin/palettes/:id (custom palettes not in use)
 */
exports.deletePalette = (req, res) => {
  let palette;
  try {
    palette = paletteService.deletePalette(req.params.id);
  } catch (error) {
    return paletteFailure(res, error, 'Delete palette');
  }
  logAdminAction(ACTIONS.DELETE_PALETTE, req, 'palette', null, palette.name, { id: palette.id, mode: palette.mode, colors: palette.colors });
  res.json({ success: true });
};

/**
 * POST /api/admin/palettes/preview { mode, colors }: the theme colors and what was adjusted, nothing saved
 */
exports.previewPalette = (req, res) => {
  const { mode, colors } = req.body || {};
  let palette;
  try {
    palette = paletteService.checkInput({ name: 'Preview', mode, colors });
  } catch (error) {
    return paletteFailure(res, error, 'Preview palette');
  }
  res.json({ tokens: paletteService.tokens(palette), adjustments: paletteService.report(palette) });
};
