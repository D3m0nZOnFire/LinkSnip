const express = require('express');
const request = require('supertest');
const { createTestUser } = require('../../setup/testHelpers');

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
  return app;
}
const asAdmin = () => appAs({ ...admin, isAdmin: 1 });

describe('admin mode routes', () => {
  it('/admin is the overview', async () => {
    const res = await request(asAdmin()).get('/admin');
    expect(res.body.view).toBe('admin-overview');
    expect(res.body.data.summary.items.map(i => i.type)).toContain('url');
  });

  it('/admin/links lists the links (what /admin used to)', async () => {
    expect((await request(asAdmin()).get('/admin/links')).body.view).toBe('admin-links');
  });

  it('/admin/settings/<tab> opens a settings tab; an unknown tab is a 404', async () => {
    const res = await request(asAdmin()).get('/admin/settings/features');
    expect(res.body).toMatchObject({ view: 'admin-settings', data: { tab: 'features' } });
    expect((await request(asAdmin()).get('/admin/settings/nope')).status).toBe(404);
  });

  it('keeps non-admins out', async () => {
    const app = appAs({ id: 99, isAdmin: 0 });
    for (const path of ['/admin', '/admin/links', '/admin/settings/roles']) {
      expect((await request(app).get(path)).status).toBe(302);
    }
  });
});
