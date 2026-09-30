const fs = require('fs');
const express = require('express');
const request = require('supertest');
const paths = require('../../../config/paths');
const configService = require('../../../services/configService');
const { featureRoutes } = require('../../../middleware/requireFeature');
const AnalyticsShare = require('../../../models/AnalyticsShare');
const { getTestDatabase } = require('../../setup/testDatabase');
const { createTestUser, createTestUrl } = require('../../setup/testHelpers');

function setFile(file, data) {
  fs.writeFileSync(file, JSON.stringify(data));
  configService.reload();
}

afterEach(() => {
  fs.rmSync(paths.ROLES_PATH, { force: true });
  fs.rmSync(paths.SETTINGS_PATH, { force: true });
  configService.reload();
});

// The x-user header stands in for the session + attachUser.
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const user = req.get('x-user') ? JSON.parse(req.get('x-user')) : null;
    req.user = user;
    req.session = user ? { userId: user.id, isAdmin: !!user.isAdmin } : {};
    res.render = (view, data) => res.json({ view, ...data });
    next();
  });
  app.use('/', featureRoutes('analyticsShareLinks', require('../../../routes/analyticsShareRoutes')));
  app.use((req, res) => res.status(404).json({ notFound: true }));
  return app;
}

const as = (user) => JSON.stringify(user);
let owner, other, admin, url, app;

beforeEach(async () => {
  owner = await createTestUser({ username: 'owner' });
  other = await createTestUser({ username: 'other' });
  admin = await createTestUser({ username: 'boss', isAdmin: 1 });
  url = createTestUrl({ slug: 'abc', creatorId: owner.id });
  app = makeApp();
});

const create = (user, body = {}) =>
  request(app).post(`/api/share-links/url/${url.id}`).set('x-user', as(user)).send(body);

describe('creating share links', () => {
  it('gives the owner a /stats/<token> link, shown once', async () => {
    const res = await create(owner, { label: 'Client', expiresInDays: 7 });

    expect(res.status).toBe(201);
    expect(res.body.shareUrl).toMatch(/\/stats\/[A-Za-z0-9_-]{43,}$/);
    expect(res.body.link).toEqual(expect.objectContaining({ label: 'Client' }));
    expect(new Date(res.body.link.expiresAt) > new Date()).toBe(true);

    const list = await request(app).get(`/api/share-links/url/${url.id}`).set('x-user', as(owner));
    expect(list.body.links).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain(res.body.shareUrl.split('/stats/')[1]);
  });

  it('records CREATE_SHARE_LINK', async () => {
    await create(owner);
    const row = getTestDatabase().prepare("SELECT * FROM audit_logs WHERE action = 'CREATE_SHARE_LINK'").get();
    expect(row).toBeDefined();
  });

  it("refuses someone else's link, but lets admins create one", async () => {
    expect((await create(other)).status).toBe(403);
    expect((await create({ ...admin, isAdmin: 1 })).status).toBe(201);
  });

  it('requires login and the analyticsShareLinks permission', async () => {
    expect((await request(app).post(`/api/share-links/url/${url.id}`).set('Accept', 'application/json')).status).toBe(401);

    setFile(paths.ROLES_PATH, { roles: { user: { permissions: { analyticsShareLinks: false } } } });
    const res = await create(owner);
    expect(res.status).toBe(403);
    expect(res.body.permission).toBe('analyticsShareLinks');
  });

  it('enforces shareLinksPerUrl, counting only active links', async () => {
    setFile(paths.ROLES_PATH, { roles: { user: { limits: { shareLinksPerUrl: 2 } } } });
    AnalyticsShare.create({ targetType: 'url', targetId: url.id, createdBy: owner.id, expiresAt: '2000-01-01T00:00:00.000Z' }); // expired

    expect((await create(owner)).status).toBe(201);
    expect((await create(owner)).status).toBe(201);
    const third = await create(owner);
    expect(third.status).toBe(403);
    expect(third.body.error).toMatch(/2 share links/);
  });

  it('treats a null limit as unlimited', async () => {
    setFile(paths.ROLES_PATH, { roles: { user: { limits: { shareLinksPerUrl: null } } } });
    for (let i = 0; i < 12; i++) expect((await create(owner)).status).toBe(201);
  });

  it('validates the label and expiry', async () => {
    expect((await create(owner, { label: 'x'.repeat(101) })).status).toBe(400);
    expect((await create(owner, { expiresInDays: 0 })).status).toBe(400);
    expect((await create(owner, { expiresInDays: 'soon' })).status).toBe(400);
    expect((await create(owner, { expiresInDays: 4000 })).status).toBe(400);
  });

  it('404s for an unknown URL', async () => {
    const res = await request(app).post('/api/share-links/url/99999').set('x-user', as(owner)).send({});
    expect(res.status).toBe(404);
  });
});

describe('viewing /stats/:token', () => {
  it('shows read-only analytics to anyone with the link, without an account', async () => {
    const token = (await create(owner)).body.shareUrl.split('/stats/')[1];

    const res = await request(app).get(`/stats/${token}`);

    expect(res.status).toBe(200);
    expect(res.body.view).toBe('analytics');
    expect(res.body.readOnly).toBe(true);
    expect(res.body.item.slug).toBe('abc');
    expect(res.body.summary).toEqual(expect.objectContaining({ total: 0 }));
  });

  it('counts views of the link', async () => {
    const { token, link } = AnalyticsShare.create({ targetType: 'url', targetId: url.id, createdBy: owner.id });
    await request(app).get(`/stats/${token}`);
    await request(app).get(`/stats/${token}`);
    expect(AnalyticsShare.findById(link.id).viewCount).toBe(2);
  });

  it('404s for an unknown, expired or revoked token', async () => {
    const expired = AnalyticsShare.create({ targetType: 'url', targetId: url.id, createdBy: owner.id, expiresAt: '2000-01-01T00:00:00.000Z' }).token;
    const revoked = AnalyticsShare.create({ targetType: 'url', targetId: url.id, createdBy: owner.id });
    AnalyticsShare.revoke(revoked.link.id);

    for (const token of ['nope', expired, revoked.token]) {
      expect((await request(app).get(`/stats/${token}`)).status).toBe(404);
    }
  });

  it('404s when the feature is switched off', async () => {
    const { token } = AnalyticsShare.create({ targetType: 'url', targetId: url.id, createdBy: owner.id });
    setFile(paths.SETTINGS_PATH, { features: { analyticsShareLinks: false } });
    expect((await request(app).get(`/stats/${token}`)).status).toBe(404);
  });
});

describe('revoking', () => {
  const revoke = (user, id) => request(app).delete(`/api/share-links/${id}`).set('x-user', as(user));

  it('lets the owner revoke, which kills the link', async () => {
    const { token, link } = AnalyticsShare.create({ targetType: 'url', targetId: url.id, createdBy: owner.id });

    expect((await revoke(owner, link.id)).status).toBe(200);
    expect((await request(app).get(`/stats/${token}`)).status).toBe(404);
    expect(getTestDatabase().prepare("SELECT * FROM audit_logs WHERE action = 'REVOKE_SHARE_LINK'").get()).toBeDefined();
  });

  it('refuses other users, allows admins', async () => {
    const { link } = AnalyticsShare.create({ targetType: 'url', targetId: url.id, createdBy: owner.id });

    expect((await revoke(other, link.id)).status).toBe(403);
    expect((await revoke({ ...admin, isAdmin: 1 }, link.id)).status).toBe(200);
  });

  it('404s for an unknown link', async () => {
    expect((await revoke(owner, 99999)).status).toBe(404);
  });
});

describe('Admin → Analytics Shares', () => {
  it('lists every active link for admins', async () => {
    AnalyticsShare.create({ targetType: 'url', targetId: url.id, createdBy: owner.id, label: 'Client' });

    const res = await request(app).get('/admin/analytics-shares').set('x-user', as({ ...admin, isAdmin: 1 }));

    expect(res.body.view).toBe('admin-analytics-shares');
    expect(res.body.links).toEqual([expect.objectContaining({ label: 'Client', slug: 'abc', createdByUsername: 'owner' })]);
  });

  it('keeps non-admins out', async () => {
    const res = await request(app).get('/admin/analytics-shares').set('x-user', as(owner));
    expect(res.status).toBe(302);
  });
});

describe('removed user-to-user sharing', () => {
  it.each([
    ['get', '/shared-analytics'],
    ['get', '/api/analytics-shares/my-shares'],
    ['post', '/api/analytics-shares']
  ])('%s %s no longer exists', async (method, path) => {
    expect((await request(app)[method](path).set('x-user', as(owner))).status).toBe(404);
  });
});
