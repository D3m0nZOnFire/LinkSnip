const fs = require('fs');
const express = require('express');
const request = require('supertest');
const paths = require('../../../config/paths');
const configService = require('../../../services/configService');
const paletteService = require('../../../services/paletteService');
const brandingService = require('../../../services/brandingService');
const { getTestDatabase } = require('../../setup/testDatabase');
const { createTestUser } = require('../../setup/testHelpers');

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>');

afterEach(() => {
  fs.rmSync(paths.BRANDING_DIR, { recursive: true, force: true });
  fs.rmSync(paths.SETTINGS_PATH, { force: true });
  configService.reload();
});

let admin;
beforeEach(async () => {
  admin = await createTestUser({ username: 'boss', isAdmin: 1 });
});

// The public routes are mounted before sessions in app.js; the admin ones after
function appAs(user) {
  const app = express();
  app.use(require('../../../routes/brandingRoutes'));
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = user;
    req.session = user ? { userId: user.id, isAdmin: !!user.isAdmin } : {};
    res.render = (view, data) => res.json({ view, data });
    next();
  });
  app.use(require('../../../routes/adminRoutes'));
  return app;
}
const asAdmin = () => appAs({ ...admin, isAdmin: 1 });
const audit = (action) => getTestDatabase().prepare('SELECT * FROM audit_logs WHERE action = ?').all(action);

describe('GET /theme.css', () => {
  it('serves the generated palette CSS', async () => {
    const res = await request(appAs(null)).get('/theme.css');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/css/);
    expect(res.text).toBe(paletteService.themeCss().css);
  });

  it('lets browsers keep the current version for good, and re-check any other', async () => {
    const { hash } = paletteService.themeCss();
    expect((await request(appAs(null)).get(`/theme.css?v=${hash}`)).headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect((await request(appAs(null)).get('/theme.css?v=old')).headers['cache-control']).toBe('no-cache');
  });
});

describe('GET /branding/:asset', () => {
  it("serves LinkSnip's logo until one is uploaded", async () => {
    const res = await request(appAs(null)).get('/branding/logo');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.body).toEqual(fs.readFileSync(`${paths.PROJECT_ROOT}/public/logo.png`));
  });

  it('serves the uploaded file with its type, not sniffable', async () => {
    brandingService.saveAsset('logo', PNG);
    const res = await request(appAs(null)).get('/branding/logo');
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.body).toEqual(PNG);
  });

  // Opened on its own, an SVG is a document: keep anything in it from running
  it('serves SVG sandboxed', async () => {
    brandingService.saveAsset('logo', SVG);
    const res = await request(appAs(null)).get('/branding/logo');
    expect(res.headers['content-type']).toMatch(/^image\/svg\+xml/);
    expect(res.headers['content-security-policy']).toMatch(/sandbox/);
    expect(res.headers['content-security-policy']).toMatch(/default-src 'none'/);
  });

  it('falls back to the logo for the favicon', async () => {
    brandingService.saveAsset('logo', PNG);
    expect((await request(appAs(null)).get('/branding/favicon')).body).toEqual(PNG);
  });

  it('404s for anything else', async () => {
    expect((await request(appAs(null)).get('/branding/settings')).status).toBe(404);
  });
});

describe('GET /admin/appearance', () => {
  it('renders the page with the palettes of each mode and the current choice', async () => {
    const res = await request(asAdmin()).get('/admin/appearance');
    expect(res.body.view).toBe('admin-appearance');
    const { palettes, current } = res.body.data;
    expect(palettes.dark.map(p => p.id)).toEqual(paletteService.listPalettes('dark').map(p => p.id));
    expect(palettes.light.map(p => p.id)).toEqual(paletteService.listPalettes('light').map(p => p.id));
    expect(palettes.dark[0].tokens['--primary']).toMatch(/^#/); // for the swatches and the live preview
    expect(current).toEqual({
      name: 'LinkSnip',
      tagline: configService.get('branding.tagline'),
      darkPalette: 'linksnip-dark',
      lightPalette: 'linksnip-light',
      logo: false,
      favicon: false
    });
  });

  it('keeps non-admins out', async () => {
    expect((await request(appAs({ id: 99, isAdmin: 0 })).get('/admin/appearance')).status).toBe(302);
  });
});

describe('PUT /api/admin/appearance', () => {
  const put = (body, app = asAdmin()) => request(app).put('/api/admin/appearance').send(body);

  it('saves the name, tagline and palettes, and logs the change', async () => {
    const res = await put({ name: ' Snipz ', tagline: 'Tiny links.', darkPalette: 'tokyo-night', lightPalette: 'rose-pine' });
    expect(res.status).toBe(200);
    expect(configService.get('branding.name')).toBe('Snipz');
    expect(configService.get('branding.darkPalette')).toBe('tokyo-night');
    expect(res.body.themeUrl).toBe(`/theme.css?v=${paletteService.themeCss().hash}`);

    const [row] = audit('UPDATE_SETTINGS');
    expect(JSON.parse(row.details)).toMatchObject({ 'branding.darkPalette': { from: 'linksnip-dark', to: 'tokyo-night' } });
  });

  it('saves only what is sent', async () => {
    await put({ darkPalette: 'nord' });
    expect(configService.get('branding.name')).toBe('LinkSnip');
  });

  it('refuses a palette that does not exist or is of the other mode', async () => {
    const res = await put({ darkPalette: 'rose-pine', lightPalette: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([
      'Dark palette: "Rosé Pine" is a light palette.',
      'Light palette: There is no palette "nope".'
    ]);
    expect(configService.get('branding.darkPalette')).toBe('linksnip-dark');
  });

  it('refuses an empty name and unknown fields', async () => {
    expect((await put({ name: '   ' })).status).toBe(400);
    const res = await put({ 'registration.open': false });
    expect(res.status).toBe(400);
    expect(configService.get('registration.open')).toBe(true);
  });

  it('keeps non-admins out', async () => {
    expect((await put({ name: 'x' }, appAs({ id: 99, isAdmin: 0 }))).status).toBe(302);
  });
});

describe('POST / DELETE /api/admin/branding/:asset', () => {
  it('stores an upload and logs it', async () => {
    const res = await request(asAdmin()).post('/api/admin/branding/logo').attach('file', PNG, 'logo.png');
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/^\/branding\/logo\?v=\d+$/);
    expect(brandingService.assetFile('logo')).not.toBeNull();
    expect(JSON.parse(audit('UPDATE_BRANDING')[0].details)).toMatchObject({ asset: 'logo', type: 'png' });
  });

  it('answers 400 with the reason for a file it does not take', async () => {
    const res = await request(asAdmin()).post('/api/admin/branding/logo').attach('file', Buffer.from('nope'), 'x.png');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/PNG, JPG, WebP or SVG/);
  });

  it('answers 413 for a file over the limit, without reading it all', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(brandingService.MAX_BYTES + 1)]);
    expect((await request(asAdmin()).post('/api/admin/branding/logo').attach('file', big, 'big.png')).status).toBe(413);
  });

  it('answers 400 without a file, 404 for an unknown asset', async () => {
    expect((await request(asAdmin()).post('/api/admin/branding/logo')).status).toBe(400);
    expect((await request(asAdmin()).post('/api/admin/branding/banner').attach('file', PNG, 'b.png')).status).toBe(404);
  });

  it('removes an upload and logs it', async () => {
    brandingService.saveAsset('logo', PNG);
    const res = await request(asAdmin()).delete('/api/admin/branding/logo');
    expect(res.status).toBe(200);
    expect(res.body.url).toBe('/logo.png');
    expect(brandingService.assetFile('logo')).toBeNull();
    expect(JSON.parse(audit('UPDATE_BRANDING')[0].details)).toMatchObject({ asset: 'logo', removed: true });
  });

  it('keeps non-admins out', async () => {
    const app = appAs({ id: 99, isAdmin: 0 });
    expect((await request(app).post('/api/admin/branding/logo').attach('file', PNG, 'l.png')).status).toBe(302);
    expect((await request(app).delete('/api/admin/branding/logo')).status).toBe(302);
  });
});
