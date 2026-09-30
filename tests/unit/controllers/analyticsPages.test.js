const fs = require('fs');
const express = require('express');
const request = require('supertest');
const paths = require('../../../config/paths');
const configService = require('../../../services/configService');
const { featureRoutes } = require('../../../middleware/requireFeature');
const AnalyticsEvent = require('../../../models/AnalyticsEvent');
const { getTestDatabase } = require('../../setup/testDatabase');
const {
  createTestUser, createTestUrl, createTestBundle, createTestBundleItem, createTestPaste, createTestFile
} = require('../../setup/testHelpers');

function setFile(file, data) {
  fs.writeFileSync(file, JSON.stringify(data));
  configService.reload();
}
afterEach(() => {
  fs.rmSync(paths.ROLES_PATH, { force: true });
  fs.rmSync(paths.SETTINGS_PATH, { force: true });
  configService.reload();
});

// Mounted as in app.js; the x-user header stands in for the session + attachUser.
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
  app.use('/', require('../../../routes/analyticsRoutes'));
  app.use('/', featureRoutes('analyticsShareLinks', require('../../../routes/analyticsShareRoutes')));
  app.use('/', require('../../../routes/tagRoutes'));
  app.use((req, res) => res.status(404).json({ notFound: true }));
  return app;
}

const as = (user) => JSON.stringify(user);
let owner, other, admin, app;
beforeEach(async () => {
  const row = (r) => ({ id: r.id, username: r.username, isAdmin: r.isAdmin, role: r.role });
  owner = row(await createTestUser({ username: 'owner' }));
  other = row(await createTestUser({ username: 'other' }));
  admin = row(await createTestUser({ username: 'boss', isAdmin: 1 }));
  app = makeApp();
});

const MAKE = {
  url: () => createTestUrl({ slug: 'it', creatorId: owner.id }),
  bundle: () => createTestBundle({ slug: 'it', creatorId: owner.id }),
  paste: () => createTestPaste(owner.id, { slug: 'it' }),
  file: () => createTestFile(owner.id, { slug: 'it' })
};
const record = (type, id, fields = {}) => AnalyticsEvent.record({ targetType: type, targetId: id, ipHash: 'h', ...fields });

describe.each(Object.keys(MAKE))('/analytics/%s/:id', (type) => {
  it('shows the owner the shared summary', async () => {
    const item = MAKE[type]();
    record(type, item.id, { ipHash: 'a' });
    record(type, item.id, { ipHash: 'b' });

    const res = await request(app).get(`/analytics/${type}/${item.id}`).set('x-user', as(owner));

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ view: 'analytics', type, readOnly: false }));
    expect(res.body.item.id).toBe(item.id);
    expect(res.body.summary).toEqual(expect.objectContaining({ total: 2, uniqueVisitors: 2 }));
  });

  it('lets admins in and sends other users to their dashboard', async () => {
    const item = MAKE[type]();
    expect((await request(app).get(`/analytics/${type}/${item.id}`).set('x-user', as(admin))).status).toBe(200);
    const res = await request(app).get(`/analytics/${type}/${item.id}`).set('x-user', as(other));
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/dashboard');
  });

  it('answers JSON on /api/analytics/:type/:id for the owner, 403 for others', async () => {
    const item = MAKE[type]();
    record(type, item.id);
    const res = await request(app).get(`/api/analytics/${type}/${item.id}`).set('x-user', as(owner));
    expect(res.status).toBe(200);
    expect(res.body.summary.total).toBe(1);
    expect((await request(app).get(`/api/analytics/${type}/${item.id}`).set('x-user', as(other))).status).toBe(403);
  });

  it('404s an unknown item', async () => {
    expect((await request(app).get(`/analytics/${type}/99999`).set('x-user', as(owner))).status).toBe(404);
  });
});

describe('analytics pages', () => {
  it('bundle pages include clicks per item', async () => {
    const bundle = MAKE.bundle();
    const item = createTestBundleItem(bundle.id, { label: 'Docs' });
    record('bundle', bundle.id, { subTargetId: item.id });

    const res = await request(app).get(`/analytics/bundle/${bundle.id}`).set('x-user', as(owner));
    expect(res.body.itemClicks).toEqual([expect.objectContaining({ id: item.id, label: 'Docs', clickCount: 1 })]);
  });

  it('404s an unknown type, and a type whose feature is off', async () => {
    const paste = MAKE.paste();
    expect((await request(app).get(`/analytics/nope/${paste.id}`).set('x-user', as(owner))).status).toBe(404);
    setFile(paths.SETTINGS_PATH, { features: { pastes: false } });
    expect((await request(app).get(`/analytics/paste/${paste.id}`).set('x-user', as(owner))).status).toBe(404);
  });

  it('needs login and the analytics permission', async () => {
    const url = MAKE.url();
    expect((await request(app).get(`/analytics/url/${url.id}`)).status).toBe(302);
    setFile(paths.ROLES_PATH, { roles: { user: { permissions: { analytics: false } } } });
    expect((await request(app).get(`/analytics/url/${url.id}`).set('x-user', as(owner))).status).not.toBe(200);
  });

  it.each([
    ['/analytics/5', '/analytics/url/5', 301],
    ['/bundle-analytics/5', '/analytics/bundle/5', 301],
    ['/pastes/5/analytics', '/analytics/paste/5', 301],
    ['/api/analytics/5', '/api/analytics/url/5', 308],
    ['/api/bundle-analytics/5', '/api/analytics/bundle/5', 308]
  ])('the old address %s redirects to %s', async (from, to, code) => {
    const res = await request(app).get(from).set('x-user', as(owner));
    expect(res.status).toBe(code);
    expect(res.headers.location).toBe(to);
  });

  it('Admin → Analytics ranks links and counts all link events', async () => {
    const url = MAKE.url();
    record('url', url.id); record('url', url.id); record('paste', url.id);
    const res = await request(app).get('/admin/analytics').set('x-user', as(admin));
    expect(res.body.totalClicks).toBe(2);
    expect(res.body.topUrls[0]).toEqual(expect.objectContaining({ urlId: url.id, clicks: 2 }));
  });

  it('tag analytics count clicks per day from the events', async () => {
    const url = MAKE.url();
    const tag = getTestDatabase().prepare("INSERT INTO tags (name, color, userId) VALUES ('work', '#fff', ?)").run(owner.id).lastInsertRowid;
    getTestDatabase().prepare('INSERT INTO url_tags (urlId, tagId) VALUES (?, ?)').run(url.id, tag);
    record('url', url.id); record('url', url.id);

    const res = await request(app).get(`/api/tags/${tag}/analytics`).set('x-user', as(owner));
    expect(res.body.clicksByDate).toEqual([{ date: new Date().toISOString().split('T')[0], count: 2 }]);
  });
});

describe('share links for every type', () => {
  const create = (type, id, user = owner, body = {}) =>
    request(app).post(`/api/share-links/${type}/${id}`).set('x-user', as(user)).send(body);

  it.each(Object.keys(MAKE))('%s: the owner creates a link, and anyone with it sees read-only stats', async (type) => {
    const item = MAKE[type]();
    record(type, item.id);

    const created = await create(type, item.id);
    expect(created.status).toBe(201);
    const token = created.body.shareUrl.split('/stats/')[1];

    const stats = await request(app).get(`/stats/${token}`);
    expect(stats.status).toBe(200);
    expect(stats.body).toEqual(expect.objectContaining({ view: 'analytics', type, readOnly: true }));
    expect(stats.body.summary.total).toBe(1);

    const list = await request(app).get(`/api/share-links/${type}/${item.id}`).set('x-user', as(owner));
    expect(list.body.links).toHaveLength(1);
  });

  it('refuses other users, lets admins, 404s unknown items and types', async () => {
    const paste = MAKE.paste();
    expect((await create('paste', paste.id, other)).status).toBe(403);
    expect((await create('paste', paste.id, admin)).status).toBe(201);
    expect((await create('paste', 99999)).status).toBe(404);
    expect((await create('nope', paste.id)).status).toBe(404);
  });

  it('applies shareLinksPerUrl to each item', async () => {
    setFile(paths.ROLES_PATH, { roles: { user: { limits: { shareLinksPerUrl: 1 } } } });
    const paste = MAKE.paste();
    const file = MAKE.file();
    expect((await create('paste', paste.id)).status).toBe(201);
    expect((await create('paste', paste.id)).status).toBe(403);
    expect((await create('file', file.id)).status).toBe(201);
  });

  it('the old link-only address redirects, for POST and GET', async () => {
    const url = MAKE.url();
    const post = await request(app).post(`/api/urls/${url.id}/share-links`).set('x-user', as(owner)).send({});
    expect(post.status).toBe(308);
    expect(post.headers.location).toBe(`/api/share-links/url/${url.id}`);
  });

  it('revoking works for any type, and Admin → Analytics Shares lists every type', async () => {
    const paste = MAKE.paste();
    const url = MAKE.url();
    const link = (await create('paste', paste.id)).body.link;
    await create('url', url.id);

    const page = await request(app).get('/admin/analytics-shares').set('x-user', as(admin));
    expect(page.body.links.map(l => [l.targetType, l.path]).sort()).toEqual([['paste', '/p/it'], ['url', '/s/it']]);

    expect((await request(app).delete(`/api/share-links/${link.id}`).set('x-user', as(other))).status).toBe(403);
    expect((await request(app).delete(`/api/share-links/${link.id}`).set('x-user', as(owner))).status).toBe(200);
  });
});
