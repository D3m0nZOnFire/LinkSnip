const fs = require('fs');
const express = require('express');
const request = require('supertest');
const paths = require('../../../config/paths');
const configService = require('../../../services/configService');
const AnalyticsEvent = require('../../../models/AnalyticsEvent');
const {
  createTestUser, createTestUrl, createTestBundle, createTestPaste, createTestFile, createTestTag, tagItem
} = require('../../setup/testHelpers');

// The tags page and tag analytics count every content type (they counted only links),
// and leave out types whose feature is switched off.

function setSettings(data) {
  fs.writeFileSync(paths.SETTINGS_PATH, JSON.stringify(data));
  configService.reload();
}
afterEach(() => {
  fs.rmSync(paths.SETTINGS_PATH, { force: true });
  configService.reload();
});

// The x-user header stands in for the session + attachUser; render answers JSON.
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
  app.use('/', require('../../../routes/tagRoutes'));
  return app;
}

const as = (user) => JSON.stringify(user);
const today = () => new Date().toISOString().split('T')[0];
const visit = (type, id) => AnalyticsEvent.record({ targetType: type, targetId: id, ipHash: 'h' });

let owner, other, app, tag, made;
beforeEach(async () => {
  const row = (r) => ({ id: r.id, username: r.username, isAdmin: r.isAdmin, role: r.role });
  owner = row(await createTestUser({ username: 'owner', email: 'owner@example.com' }));
  other = row(await createTestUser({ username: 'other', email: 'other@example.com' }));
  app = makeApp();

  // One tagged item of every type; the file is visited most, the bundle not at all
  tag = createTestTag({ name: 'work', userId: owner.id });
  made = {
    url: createTestUrl({ slug: 'l1', creatorId: owner.id }),
    bundle: createTestBundle({ slug: 'b1', creatorId: owner.id }),
    paste: createTestPaste(owner.id, { slug: 'p1' }),
    file: createTestFile(owner.id, { slug: 'f1' })
  };
  for (const [type, item] of Object.entries(made)) tagItem(type, item.id, tag.id);
  visit('url', made.url.id);
  visit('paste', made.paste.id); visit('paste', made.paste.id);
  visit('file', made.file.id); visit('file', made.file.id); visit('file', made.file.id);
});

describe('GET /tags', () => {
  it('counts the tagged items of every type and their visits', async () => {
    const res = await request(app).get('/tags').set('x-user', as(owner));

    expect(res.body.view).toBe('tags');
    expect(res.body.tags).toEqual([expect.objectContaining({
      name: 'work', itemCount: 4, visits: 6, counts: { url: 1, bundle: 1, paste: 1, file: 1 }
    })]);
  });

  it('leaves out a type whose feature is off', async () => {
    setSettings({ features: { pastes: false } });

    const res = await request(app).get('/tags').set('x-user', as(owner));

    expect(res.body.tags[0]).toEqual(expect.objectContaining({
      itemCount: 3, visits: 4, counts: { url: 1, bundle: 1, file: 1 }
    }));
  });
});

describe('GET /api/tags/:id/analytics', () => {
  it('sums every type: totals, per type, per day and the top items', async () => {
    const res = await request(app).get(`/api/tags/${tag.id}/analytics`).set('x-user', as(owner));

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      totalItems: 4,
      totalVisits: 6,
      counts: { url: 1, bundle: 1, paste: 1, file: 1 },
      visitsByDate: [{ date: today(), count: 6 }]
    }));
    expect(res.body.topItems.map(i => [i.type, i.visits])).toEqual([
      ['file', 3], ['paste', 2], ['url', 1], ['bundle', 0]
    ]);
    expect(res.body.topItems[0]).toEqual(expect.objectContaining({ id: made.file.id, slug: 'f1' }));
  });

  it('leaves out a type whose feature is off', async () => {
    setSettings({ features: { files: false } });

    const res = await request(app).get(`/api/tags/${tag.id}/analytics`).set('x-user', as(owner));

    expect(res.body).toEqual(expect.objectContaining({
      totalItems: 3, totalVisits: 3, counts: { url: 1, bundle: 1, paste: 1 },
      visitsByDate: [{ date: today(), count: 3 }]
    }));
    expect(res.body.topItems.map(i => i.type)).not.toContain('file');
  });

  it("refuses another user's tag", async () => {
    const res = await request(app).get(`/api/tags/${tag.id}/analytics`).set('x-user', as(other));
    expect(res.status).toBe(403);
  });
});

describe('GET /tags/:id/analytics', () => {
  it('lists the tagged items of every type with their page and analytics addresses', async () => {
    const res = await request(app).get(`/tags/${tag.id}/analytics`).set('x-user', as(owner));

    expect(res.body.view).toBe('tag-analytics');
    expect(res.body.items.map(i => i.type).sort()).toEqual(['bundle', 'file', 'paste', 'url']);
    expect(res.body.items.find(i => i.type === 'paste')).toEqual(expect.objectContaining({
      slug: 'p1', visits: 2, publicPath: '/p/p1', analyticsPath: `/analytics/paste/${made.paste.id}`
    }));
    expect(res.body.items.find(i => i.type === 'url').publicPath).toBe('/s/l1');
  });

  it("sends another user's tag back to /tags", async () => {
    const res = await request(app).get(`/tags/${tag.id}/analytics`).set('x-user', as(other));
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/tags');
  });
});
