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

  it('marks built-in roles, counts each role\'s accounts and passes the file version', async () => {
    fs.writeFileSync(paths.ROLES_PATH, JSON.stringify({ roles: { marketing: { label: 'Marketing' } } }));
    configService.reload();
    await createTestUser({ username: 'm1', role: 'marketing' });
    await createTestUser({ username: 'm2', role: 'marketing' });
    await createTestUser({ username: 't1', role: 'trusted' });
    await createTestUser({ username: 'n1', role: null });
    await createTestUser({ username: 'g1', role: 'ghost' });

    const { roleGrid } = render()._viewData;
    const byName = Object.fromEntries(roleGrid.roles.map(r => [r.name, r]));

    expect(byName.trusted).toEqual(expect.objectContaining({ builtIn: true, users: 1 }));
    expect(byName.marketing).toEqual(expect.objectContaining({ builtIn: false, users: 2 }));
    // NULL and unknown roles follow the default role (the admin "boss" has none either)
    expect(byName.user.users).toBe(3);
    expect(byName.anonymous.users).toBe(0);
    expect(roleGrid.version).toBe(configService.rolesVersion());
  });

  // Admin → Settings is split into tabs: /admin/settings/<tab>
  it('opens on General and knows every tab', () => {
    const { tab, tabs } = render()._viewData;
    expect(tab).toBe('general');
    expect(tabs.map(t => [t.id, t.href])).toEqual([
      ['general', '/admin/settings'],
      ['features', '/admin/settings/features'],
      ['content', '/admin/settings/content'],
      ['moderation', '/admin/settings/moderation'],
      ['retention', '/admin/settings/retention'],
      ['roles', '/admin/settings/roles']
    ]);
  });

  it('puts every settings section on exactly one tab', () => {
    const { sections, tabs } = render()._viewData;
    for (const section of sections) {
      expect(tabs.filter(t => t.sections.includes(section.name)).map(t => t.id)).toHaveLength(1);
    }
  });

  it('opens the tab named in the address', () => {
    const res = createMockResponse();
    AdminSettingsController.getSettingsPage(createMockRequest({ ...adminReq(), params: { tab: 'roles' } }), res);
    expect(res._viewData.tab).toBe('roles');
  });

  it('passes an unknown tab on (404)', () => {
    const res = createMockResponse();
    const next = jest.fn();
    AdminSettingsController.getSettingsPage(createMockRequest({ ...adminReq(), params: { tab: 'nope' } }), res, next);
    expect(next).toHaveBeenCalled();
    expect(res._view).toBeUndefined();
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

describe('AdminSettingsController role editing', () => {
  const roleAudit = () => getTestDatabase()
    .prepare("SELECT action, targetId, details FROM audit_logs WHERE action LIKE '%ROLE%' ORDER BY id").all()
    .map(row => ({ ...row, details: JSON.parse(row.details) }));
  const roleOf = (id) => getTestDatabase().prepare('SELECT role FROM users WHERE id = ?').get(id).role;

  async function call(method, body, params = {}) {
    const req = adminReq(body);
    req.params = params;
    const res = createMockResponse();
    await AdminSettingsController[method](req, res);
    return res;
  }

  describe('updateRoles (PUT /api/admin/roles)', () => {
    it('saves changes, applies them and returns the new version', async () => {
      const version = configService.rolesVersion();
      const res = await call('updateRoles', { version, defaultRole: 'trusted', roles: { user: { limits: { urlsPerHour: 5 } } } });

      expect(res.statusCode).toBe(200);
      expect(res._jsonData).toEqual({
        success: true,
        changed: {
          defaultRole: { from: 'user', to: 'trusted' },
          'roles.user.limits.urlsPerHour': { from: 100, to: 5 }
        },
        created: [],
        version: configService.rolesVersion()
      });
      expect(res._jsonData.version).not.toBe(version);
      expect(configService.getRoles().roles.user.limits.urlsPerHour).toBe(5);
    });

    it('logs UPDATE_ROLES with the diff, and CREATE_ROLE for each new role', async () => {
      await call('updateRoles', {
        version: configService.rolesVersion(),
        roles: { user: { label: 'Member' }, marketing: { label: 'Marketing' } }
      });

      const rows = roleAudit();
      expect(rows.map(r => r.action)).toEqual(['UPDATE_ROLES', 'CREATE_ROLE']);
      expect(rows[0].details).toEqual({ 'roles.user.label': { from: 'User', to: 'Member' } });
      expect(rows[1].targetId).toBe('marketing');
      expect(rows[1].details.label).toBe('Marketing');
      expect(rows[1].details.limits.urlsPerHour).toBe(100);
    });

    it('does not log when nothing changed', async () => {
      const res = await call('updateRoles', { version: configService.rolesVersion(), roles: { user: { label: 'User' } } });
      expect(res.statusCode).toBe(200);
      expect(roleAudit()).toEqual([]);
    });

    it('answers 400 with every error', async () => {
      const res = await call('updateRoles', {
        version: configService.rolesVersion(),
        roles: { user: { limits: { urlsPerHour: -1 } }, 'Bad Name': { label: 'X' } }
      });

      expect(res.statusCode).toBe(400);
      expect(res._jsonData.success).toBe(false);
      expect(res._jsonData.errors).toHaveLength(2);
      expect(roleAudit()).toEqual([]);
    });

    it('answers 409 when roles.json changed on disk since the page was loaded', async () => {
      const version = configService.rolesVersion();
      fs.writeFileSync(paths.ROLES_PATH, JSON.stringify({ roles: { user: { limits: { urlsPerHour: 7 } } } }));

      const res = await call('updateRoles', { version, roles: { user: { label: 'Member' } } });

      expect(res.statusCode).toBe(409);
      expect(res._jsonData).toEqual({ success: false, conflict: true, errors: [expect.stringMatching(/reload/i)] });
      expect(JSON.parse(fs.readFileSync(paths.ROLES_PATH, 'utf8'))).toEqual({ roles: { user: { limits: { urlsPerHour: 7 } } } });
    });

    it('requires the version', async () => {
      const res = await call('updateRoles', { roles: { user: { label: 'Member' } } });
      expect(res.statusCode).toBe(400);
      expect(configService.getRoles().roles.user.label).toBe('User');
    });
  });

  describe('deleteRole (DELETE /api/admin/roles/:name)', () => {
    let m1, m2, other;
    beforeEach(async () => {
      fs.writeFileSync(paths.ROLES_PATH, JSON.stringify({ roles: { marketing: { label: 'Marketing' } } }));
      configService.reload();
      m1 = await createTestUser({ username: 'm1', role: 'marketing' });
      m2 = await createTestUser({ username: 'm2', role: 'marketing' });
      other = await createTestUser({ username: 'o1', role: 'trusted' });
    });

    it('moves its accounts to the chosen role, then deletes it', async () => {
      const res = await call('deleteRole', { version: configService.rolesVersion(), moveTo: 'trusted' }, { name: 'marketing' });

      expect(res.statusCode).toBe(200);
      expect(res._jsonData).toEqual({ success: true, moved: 2, version: configService.rolesVersion() });
      expect([roleOf(m1.id), roleOf(m2.id), roleOf(other.id)]).toEqual(['trusted', 'trusted', 'trusted']);
      expect(configService.getRoles().roles.marketing).toBeUndefined();
    });

    it('with moveTo null, clears their role so they follow the default role', async () => {
      const res = await call('deleteRole', { version: configService.rolesVersion(), moveTo: null }, { name: 'marketing' });

      expect(res.statusCode).toBe(200);
      expect([roleOf(m1.id), roleOf(m2.id)]).toEqual([null, null]);
      expect(roleOf(other.id)).toBe('trusted');
    });

    it('logs DELETE_ROLE with where the accounts went', async () => {
      await call('deleteRole', { version: configService.rolesVersion(), moveTo: 'trusted' }, { name: 'marketing' });

      expect(roleAudit()).toEqual([expect.objectContaining({
        action: 'DELETE_ROLE',
        targetId: 'marketing',
        details: expect.objectContaining({ moveTo: 'trusted', moved: 2, role: expect.objectContaining({ label: 'Marketing' }) })
      })]);
    });

    it('requires a choice for its accounts', async () => {
      const res = await call('deleteRole', { version: configService.rolesVersion() }, { name: 'marketing' });

      expect(res.statusCode).toBe(400);
      expect(configService.getRoles().roles.marketing).toBeDefined();
    });

    it.each(['marketing', 'anonymous', 'ghost'])('refuses to move the accounts to %s', async (moveTo) => {
      const res = await call('deleteRole', { version: configService.rolesVersion(), moveTo }, { name: 'marketing' });

      expect(res.statusCode).toBe(400);
      expect(roleOf(m1.id)).toBe('marketing');
      expect(configService.getRoles().roles.marketing).toBeDefined();
    });

    it('leaves the accounts alone when the role can\'t be deleted', async () => {
      fs.writeFileSync(paths.ROLES_PATH, JSON.stringify({ defaultRole: 'marketing', roles: { marketing: { label: 'Marketing' } } }));
      configService.reload();

      const res = await call('deleteRole', { version: configService.rolesVersion(), moveTo: 'trusted' }, { name: 'marketing' });

      expect(res.statusCode).toBe(400);
      expect(res._jsonData.errors[0]).toMatch(/default/);
      expect(roleOf(m1.id)).toBe('marketing');
      expect(roleAudit()).toEqual([]);
    });

    it('answers 409 on a stale version and changes nothing', async () => {
      const res = await call('deleteRole', { version: 'stale', moveTo: 'trusted' }, { name: 'marketing' });

      expect(res.statusCode).toBe(409);
      expect(roleOf(m1.id)).toBe('marketing');
    });

    it('refuses built-in roles', async () => {
      const res = await call('deleteRole', { version: configService.rolesVersion(), moveTo: null }, { name: 'trusted' });

      expect(res.statusCode).toBe(400);
      expect(roleOf(other.id)).toBe('trusted');
    });
  });

  describe('resetRole (POST /api/admin/roles/:name/reset)', () => {
    it('resets a built-in role and logs RESET_ROLE with the diff', async () => {
      fs.writeFileSync(paths.ROLES_PATH, JSON.stringify({ roles: { trusted: { limits: { urlsPerHour: 1 } } } }));
      configService.reload();

      const res = await call('resetRole', { version: configService.rolesVersion() }, { name: 'trusted' });

      expect(res.statusCode).toBe(200);
      expect(res._jsonData).toEqual({
        success: true,
        changed: { 'roles.trusted.limits.urlsPerHour': { from: 1, to: 500 } },
        role: require('../../../config/roles.default.json').roles.trusted,
        version: configService.rolesVersion()
      });
      expect(roleAudit()).toEqual([expect.objectContaining({
        action: 'RESET_ROLE', targetId: 'trusted', details: { 'roles.trusted.limits.urlsPerHour': { from: 1, to: 500 } }
      })]);
    });

    it('refuses a custom role, and a stale version', async () => {
      fs.writeFileSync(paths.ROLES_PATH, JSON.stringify({ roles: { marketing: { label: 'Marketing' } } }));
      configService.reload();

      expect((await call('resetRole', { version: configService.rolesVersion() }, { name: 'marketing' })).statusCode).toBe(400);
      expect((await call('resetRole', { version: 'stale' }, { name: 'user' })).statusCode).toBe(409);
    });
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

    const version = configService.rolesVersion();
    const saved = await request(app).put('/api/admin/roles').send({ version, roles: { marketing: { label: 'Marketing' } } });
    expect(saved.status).toBe(200);
    expect((await request(app).post('/api/admin/roles/user/reset').send({ version: saved.body.version })).status).toBe(200);
    expect((await request(app).delete('/api/admin/roles/marketing').send({ version: configService.rolesVersion(), moveTo: null })).status).toBe(200);
  });

  it('keeps non-admins out', async () => {
    const app = appAs({ id: 99, isAdmin: 0 });

    expect((await request(app).get('/admin/settings')).status).toBe(302);
    expect((await request(app).put('/api/admin/settings').send({ 'geo.enabled': false })).status).toBe(302);
    expect(configService.get('geo.enabled')).toBe(true);

    const version = configService.rolesVersion();
    expect((await request(app).put('/api/admin/roles').send({ version, roles: { user: { label: 'X' } } })).status).toBe(302);
    expect((await request(app).post('/api/admin/roles/user/reset').send({ version })).status).toBe(302);
    expect((await request(app).delete('/api/admin/roles/trusted').send({ version, moveTo: null })).status).toBe(302);
    expect(configService.getRoles().roles.user.label).toBe('User');
  });
});
