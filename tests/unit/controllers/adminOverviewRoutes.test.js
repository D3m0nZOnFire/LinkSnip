const fs = require('fs');
const express = require('express');
const paths = require('../../../config/paths');
const configService = require('../../../services/configService');
const request = require('supertest');
const { createTestUser } = require('../../setup/testHelpers');

afterEach(() => {
  fs.rmSync(paths.SETTINGS_PATH, { force: true });
  configService.reload();
});

let admin;
beforeEach(async () => {
  admin = await createTestUser({ username: 'boss', isAdmin: 1 });
});

function appAs(user) {
  const app = express();
  app.use((req, res, next) => {
    req.user = user;
    req.session = user ? { userId: user.id, isAdmin: !!user.isAdmin } : {};
    res.render = (view, data) => res.json({ view, data });
    next();
  });
  app.use(require('../../../routes/dashboardRoutes'));
  app.use(require('../../../routes/adminRoutes'));
  app.use(require('../../../routes/fileRoutes'));
  app.use(require('../../../routes/pasteRoutes'));
  return app;
}
const asAdmin = () => appAs({ ...admin, isAdmin: 1 });

describe('admin mode routes', () => {
  it('/admin is the overview', async () => {
    const res = await request(asAdmin()).get('/admin');
    expect(res.body.view).toBe('admin-overview');
    expect(res.body.data.summary.items.map(i => i.type)).toContain('url');
  });

  it('/admin/items lists every type, filtered by the query', async () => {
    const res = await request(asAdmin()).get('/admin/items?type=paste&search=notes&status=active&sort=oldest&page=2&limit=25');
    expect(res.body.view).toBe('admin-items');
    expect(res.body.data.filters).toEqual({
      type: 'paste', search: 'notes', status: 'active', hasReports: '', sort: 'oldest', dateFrom: '', dateTo: '', limit: 25
    });
    expect(res.body.data.result).toMatchObject({ rows: [], total: 0 });
    expect(res.body.data.types).toEqual(['url', 'bundle', 'paste', 'file']);
  });

  it('/admin/items: an unknown type, or one switched off, is a 404', async () => {
    expect((await request(asAdmin()).get('/admin/items?type=nope')).status).toBe(404);
    configService.updateSettings({ 'features.files': false });
    expect((await request(asAdmin()).get('/admin/items?type=file')).status).toBe(404);
    expect((await request(asAdmin()).get('/admin/items')).body.data.types).toEqual(['url', 'bundle', 'paste']);
  });

  // The three lists the Items page replaces
  it.each([
    ['/admin/links', '/admin/items?type=url'],
    ['/admin/links?search=%40anon&status=expired', '/admin/items?type=url&search=%40anon&status=expired'],
    ['/admin/files', '/admin/items?type=file'],
    ['/admin/pastes?search=x', '/admin/items?type=paste&search=x']
  ])('%s redirects to %s', async (from, to) => {
    const res = await request(asAdmin()).get(from);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(to);
  });

  it('/admin/settings/<tab> opens a settings tab; an unknown tab is a 404', async () => {
    const res = await request(asAdmin()).get('/admin/settings/features');
    expect(res.body).toMatchObject({ view: 'admin-settings', data: { tab: 'features' } });
    expect((await request(asAdmin()).get('/admin/settings/nope')).status).toBe(404);
  });

  it('keeps non-admins out', async () => {
    const app = appAs({ id: 99, isAdmin: 0 });
    for (const path of ['/admin', '/admin/items', '/admin/settings/roles']) {
      expect((await request(app).get(path)).status).toBe(302);
    }
  });
});
