const fs = require('fs');
const express = require('express');
const request = require('supertest');
const paths = require('../../../config/paths');
const schema = require('../../../config/schema');
const configService = require('../../../services/configService');
const AdminSettingsController = require('../../../controllers/adminSettingsController');
const { getTestDatabase } = require('../../setup/testDatabase');
const { createTestUser, createMockRequest, createMockResponse } = require('../../setup/testHelpers');

afterEach(() => {
  fs.rmSync(paths.SETTINGS_PATH, { force: true });
  fs.rmSync(paths.ROLES_PATH, { force: true });
  configService.reload();
});

let admin;
beforeEach(async () => {
  admin = await createTestUser({ username: 'boss', isAdmin: 1 });
});

function adminReq(body = {}) {
  return createMockRequest({
    body,
    user: { ...admin, isAdmin: 1 },
    session: { userId: admin.id, isAdmin: true },
    get: () => undefined
  });
}

const auditRows = () => getTestDatabase().prepare("SELECT * FROM audit_logs WHERE action = 'UPDATE_SETTINGS'").all();

describe('AdminSettingsController.getSettingsPage', () => {
  function render() {
    const res = createMockResponse();
    AdminSettingsController.getSettingsPage(adminReq(), res);
    return res;
  }

  it('renders admin-settings', () => {
    expect(render()._view).toBe('admin-settings');
  });

  it('lists every setting with its description, type and current value, grouped by section', () => {
    fs.writeFileSync(paths.SETTINGS_PATH, JSON.stringify({ pastes: { maxSizeKB: 64 } }));
    configService.reload();

    const { sections } = render()._viewData;
    const fields = sections.flatMap(s => s.fields);

    expect(fields.map(f => f.key).sort()).toEqual(Object.keys(schema.SETTINGS).sort());
    const pasteSize = fields.find(f => f.key === 'pastes.maxSizeKB');
    expect(pasteSize).toEqual(expect.objectContaining({
      value: 64,
      type: 'integer',
      min: 1,
      description: schema.SETTINGS['pastes.maxSizeKB'].description
    }));
    expect(sections.map(s => s.name)).toEqual(expect.arrayContaining(['registration', 'features', 'retention']));
  });

  it('shows every role, anonymous included, as permission and limit grids', () => {
    fs.writeFileSync(paths.ROLES_PATH, JSON.stringify({ roles: { marketing: { label: 'Marketing' } } }));
    configService.reload();

    const { roleGrid } = render()._viewData;

    expect(roleGrid.roles.map(r => r.name)).toEqual(['anonymous', 'user', 'trusted', 'unlimited', 'marketing']);
    expect(roleGrid.permissions.map(p => p.name)).toEqual(Object.keys(schema.PERMISSIONS));
    expect(roleGrid.limits.map(l => l.name)).toEqual(Object.keys(schema.LIMITS));

    const upload = roleGrid.permissions.find(p => p.name === 'uploadFiles');
    expect(upload.description).toBe(schema.PERMISSIONS.uploadFiles);
    expect(upload.values).toEqual([false, false, true, true, false]);

    const urls = roleGrid.limits.find(l => l.name === 'urlsPerHour');
    expect(urls.values).toEqual([10, 100, 500, null, 100]);
    expect(roleGrid.defaultRole).toBe('user');
  });

  it('tells the admin where the files live', () => {
    const { files } = render()._viewData;
    expect(files).toEqual({ settings: paths.SETTINGS_PATH, roles: paths.ROLES_PATH });
  });
});

describe('AdminSettingsController.updateSettings', () => {
  async function put(body) {
    const res = createMockResponse();
    await AdminSettingsController.updateSettings(adminReq(body), res);
    return res;
  }

  it('saves valid changes to settings.json and applies them', async () => {
    const res = await put({ 'registration.open': false, 'pastes.maxSizeKB': 100 });

    expect(res.statusCode).toBe(200);
    expect(res._jsonData).toEqual(expect.objectContaining({ success: true }));
    expect(configService.get('registration.open')).toBe(false);
    expect(JSON.parse(fs.readFileSync(paths.SETTINGS_PATH, 'utf8')).pastes.maxSizeKB).toBe(100);
  });

  it('records UPDATE_SETTINGS with the diff', async () => {
    await put({ 'registration.open': false, 'geo.enabled': true });

    const rows = auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(admin.id);
    expect(JSON.parse(rows[0].details)).toEqual({ 'registration.open': { from: true, to: false } });
  });

  it('does not log when nothing changed', async () => {
    const res = await put({ 'geo.enabled': true });

    expect(res.statusCode).toBe(200);
    expect(res._jsonData.changed).toEqual({});
    expect(auditRows()).toHaveLength(0);
  });

  it('rejects invalid values with every error, changing nothing', async () => {
    const res = await put({ 'pastes.maxSizeKB': 'big', 'moderation.reportThreshold': -1, 'geo.enabled': false });

    expect(res.statusCode).toBe(400);
    expect(res._jsonData.errors).toHaveLength(2);
    expect(res._jsonData.errors.join('\n')).toMatch(/pastes\.maxSizeKB/);
    expect(res._jsonData.errors.join('\n')).toMatch(/moderation\.reportThreshold/);
    expect(configService.get('geo.enabled')).toBe(true);
    expect(fs.existsSync(paths.SETTINGS_PATH)).toBe(false);
    expect(auditRows()).toHaveLength(0);
  });

  it('rejects a body that is not an object', async () => {
    const res = await put(['nope']);
    expect(res.statusCode).toBe(400);
  });
});

describe('admin settings routes', () => {
  function appAs(user) {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.user = user;
      req.session = user ? { userId: user.id, isAdmin: !!user.isAdmin } : {};
      res.render = (view) => res.json({ view });
      next();
    });
    app.use(require('../../../routes/adminRoutes'));
    return app;
  }

  it('serves the page and the API to admins', async () => {
    const app = appAs({ ...admin, isAdmin: 1 });

    expect((await request(app).get('/admin/settings')).body.view).toBe('admin-settings');
    expect((await request(app).put('/api/admin/settings').send({ 'geo.enabled': false })).status).toBe(200);
  });

  it('keeps non-admins out', async () => {
    const app = appAs({ id: 99, isAdmin: 0 });

    expect((await request(app).get('/admin/settings')).status).toBe(302);
    expect((await request(app).put('/api/admin/settings').send({ 'geo.enabled': false })).status).toBe(302);
    expect(configService.get('geo.enabled')).toBe(true);
  });
});
