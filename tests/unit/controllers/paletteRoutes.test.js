const fs = require('fs');
const express = require('express');
const request = require('supertest');
const paths = require('../../../config/paths');
const configService = require('../../../services/configService');
const paletteService = require('../../../services/paletteService');
const { getTestDatabase } = require('../../setup/testDatabase');
const { createTestUser } = require('../../setup/testHelpers');

const COLORS = { accent: '#3b82f6', background: '#0b1220', foreground: '#e6edf3', red: '#ef4444', yellow: '#f59e0b' };

afterEach(() => {
  fs.rmSync(paths.PALETTES_DIR, { recursive: true, force: true });
  fs.rmSync(paths.SETTINGS_PATH, { force: true });
  configService.reload();
  paletteService.reload();
});

let admin;
beforeEach(async () => {
  admin = await createTestUser({ username: 'boss', isAdmin: 1 });
});

function appAs(user) {
  const app = express();
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

describe('POST /api/admin/palettes', () => {
  it('creates a palette and logs it', async () => {
    const res = await request(asAdmin()).post('/api/admin/palettes').send({ name: 'Company', mode: 'dark', colors: COLORS });
    expect(res.status).toBe(201);
    expect(res.body.palette).toMatchObject({ id: 'company', name: 'Company', mode: 'dark', builtIn: false });
    expect(paletteService.getPalette('company')).not.toBeNull();
    const [row] = audit('CREATE_PALETTE');
    expect(row.targetDescription).toBe('Company');
    expect(JSON.parse(row.details)).toMatchObject({ id: 'company', mode: 'dark', colors: COLORS });
  });

  it('answers 400 with every problem', async () => {
    const res = await request(asAdmin()).post('/api/admin/palettes').send({ name: '', mode: 'dark', colors: { ...COLORS, accent: 'x' } });
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(expect.arrayContaining(['Name is required.', expect.stringMatching(/^accent/)]));
  });
});

describe('PUT /api/admin/palettes/:id', () => {
  it('updates a custom palette and logs what changed', async () => {
    paletteService.createPalette({ name: 'Company', mode: 'dark', colors: COLORS });
    const res = await request(asAdmin()).put('/api/admin/palettes/company').send({ name: 'Company', mode: 'dark', colors: { ...COLORS, accent: '#22c55e' } });
    expect(res.status).toBe(200);
    expect(paletteService.getPalette('company').colors.accent).toBe('#22c55e');
    expect(JSON.parse(audit('UPDATE_PALETTE')[0].details)).toEqual({ id: 'company', changed: { accent: { from: '#3b82f6', to: '#22c55e' } } });
  });

  it('answers 403 for a built-in palette, 404 for an unknown one, 409 for a mode switch in use', async () => {
    expect((await request(asAdmin()).put('/api/admin/palettes/nord').send({ name: 'N', mode: 'dark', colors: COLORS })).status).toBe(403);
    expect((await request(asAdmin()).put('/api/admin/palettes/nope').send({ name: 'N', mode: 'dark', colors: COLORS })).status).toBe(404);
    paletteService.createPalette({ name: 'Company', mode: 'dark', colors: COLORS });
    configService.updateSettings({ 'branding.darkPalette': 'company' });
    const res = await request(asAdmin()).put('/api/admin/palettes/company').send({ name: 'Company', mode: 'light', colors: COLORS });
    expect(res.status).toBe(409);
    expect(res.body.errors[0]).toMatch(/in use/);
  });
});

describe('DELETE /api/admin/palettes/:id', () => {
  it('deletes a custom palette and logs it', async () => {
    paletteService.createPalette({ name: 'Company', mode: 'dark', colors: COLORS });
    expect((await request(asAdmin()).delete('/api/admin/palettes/company')).status).toBe(200);
    expect(paletteService.getPalette('company')).toBeNull();
    expect(audit('DELETE_PALETTE')[0].targetDescription).toBe('Company');
  });

  it('answers 409 while it is in use', async () => {
    paletteService.createPalette({ name: 'Company', mode: 'dark', colors: COLORS });
    configService.updateSettings({ 'branding.darkPalette': 'company' });
    expect((await request(asAdmin()).delete('/api/admin/palettes/company')).status).toBe(409);
  });
});

describe('POST /api/admin/palettes/preview', () => {
  it('returns the theme colors and what had to be adjusted, saving nothing', async () => {
    const res = await request(asAdmin()).post('/api/admin/palettes/preview').send({ mode: 'dark', colors: { ...COLORS, accent: '#333a44' } });
    expect(res.status).toBe(200);
    expect(res.body.tokens['--background']).toBe('#0b1220');
    expect(res.body.adjustments.map(a => a.key)).toEqual(['accent']);
    expect(fs.existsSync(paths.PALETTES_DIR)).toBe(false);
  });

  it('answers 400 for colors it cannot read', async () => {
    const res = await request(asAdmin()).post('/api/admin/palettes/preview').send({ mode: 'dark', colors: { ...COLORS, red: 'nope' } });
    expect(res.status).toBe(400);
    expect(res.body.errors[0]).toMatch(/^red must be a color/);
  });
});

describe('the Appearance page', () => {
  it('lists custom palettes with the built-in ones, and broken files', async () => {
    paletteService.createPalette({ name: 'Company', mode: 'dark', colors: COLORS });
    fs.writeFileSync(`${paths.PALETTES_DIR}/broken.toml`, 'mode = "dark"');
    const warned = jest.spyOn(console, 'warn').mockImplementation(() => {});
    paletteService.reload();
    expect(warned).toHaveBeenCalledWith(expect.stringMatching(/^palettes\/broken\.toml: .*\(skipped\)$/));
    warned.mockRestore();
    const { data } = (await request(asAdmin()).get('/admin/appearance')).body;
    expect(data.palettes.dark.find(p => p.id === 'company')).toMatchObject({ builtIn: false });
    expect(data.problems).toEqual([{ file: 'broken.toml', errors: expect.any(Array) }]);
    expect(data.palettesDir).toBe(paths.PALETTES_DIR);
  });
});

it('keeps non-admins out', async () => {
  const app = appAs({ id: 99, isAdmin: 0 });
  expect((await request(app).post('/api/admin/palettes').send({ name: 'x', mode: 'dark', colors: COLORS })).status).toBe(302);
  expect((await request(app).put('/api/admin/palettes/x').send({})).status).toBe(302);
  expect((await request(app).delete('/api/admin/palettes/x')).status).toBe(302);
  expect((await request(app).post('/api/admin/palettes/preview').send({})).status).toBe(302);
});
