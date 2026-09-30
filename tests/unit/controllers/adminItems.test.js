const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const paths = require('../../../config/paths');
const configService = require('../../../services/configService');
const { CONTENT_TYPES } = require('../../../services/contentTypes');
const { getTestDatabase } = require('../../setup/testDatabase');
const {
  createTestUser, createTestUrl, createTestBundle, createTestPaste, createTestFile
} = require('../../setup/testHelpers');

// One set of admin routes for every content type:
//   POST   /api/admin/:type/:id/block | unblock
//   DELETE /api/admin/:type/:id
//   POST   /api/admin/:type/bulk-block | bulk-unblock   { ids }
// Audit action names stay what they were (BLOCK_URL, ADMIN_DELETE_FILE, …).

function makeApp(routers = ['adminItemRoutes']) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const user = req.get('x-user') ? JSON.parse(req.get('x-user')) : null;
    req.user = user;
    req.session = user ? { userId: user.id, isAdmin: !!user.isAdmin } : {};
    next();
  });
  for (const name of routers) app.use(require(`../../../routes/${name}`));
  app.use((req, res) => res.status(404).json({ notFound: true }));
  return app;
}

const db = () => getTestDatabase();
const row = (type, id) => db().prepare(`SELECT * FROM ${CONTENT_TYPES[type].table} WHERE id = ?`).get(id);
const audit = () => db().prepare('SELECT action, targetType, targetId, details FROM audit_logs ORDER BY id').all();
const NAME = { url: 'URL', bundle: 'BUNDLE', paste: 'PASTE', file: 'FILE' };

let app, owner, admin, adminHeader;
beforeEach(async () => {
  app = makeApp();
  owner = await createTestUser({ username: 'owner', email: 'owner@example.com' });
  admin = await createTestUser({ username: 'boss', email: 'boss@example.com', isAdmin: 1 });
  adminHeader = JSON.stringify({ id: admin.id, isAdmin: 1 });
});
afterEach(() => {
  fs.rmSync(paths.SETTINGS_PATH, { force: true });
  configService.reload();
});

let slugCounter = 0;
const MAKE = {
  url: () => createTestUrl({ slug: `u${++slugCounter}`, creatorId: owner.id }),
  bundle: () => createTestBundle({ slug: `b${++slugCounter}`, creatorId: owner.id }),
  paste: () => createTestPaste(owner.id, { slug: `p${++slugCounter}` }),
  file: () => createTestFile(owner.id, { slug: `f${++slugCounter}`, storedName: `stored${slugCounter}.bin` })
};
const as = (req, header = adminHeader) => req.set('x-user', header);

describe.each(Object.keys(MAKE))('%s', (type) => {
  it('an admin blocks and unblocks it, audit-logged as before', async () => {
    const item = MAKE[type]();

    const blocked = await as(request(app).post(`/api/admin/${type}/${item.id}/block`));
    expect(blocked.status).toBe(200);
    expect(blocked.body.success).toBe(true);
    expect(row(type, item.id).isBlocked).toBe(1);

    expect((await as(request(app).post(`/api/admin/${type}/${item.id}/unblock`))).status).toBe(200);
    expect(row(type, item.id).isBlocked).toBe(0);

    expect(audit().map(a => [a.action, a.targetType, a.targetId])).toEqual([
      [`BLOCK_${NAME[type]}`, type, item.id], [`UNBLOCK_${NAME[type]}`, type, item.id]
    ]);
    expect(JSON.parse(audit()[0].details)).toEqual(expect.objectContaining({ slug: item.slug, manual: true, owner: owner.id }));
  });

  it('an admin deletes it, audit-logged', async () => {
    const item = MAKE[type]();

    const res = await as(request(app).delete(`/api/admin/${type}/${item.id}`));

    expect(res.status).toBe(200);
    expect(row(type, item.id)).toBeUndefined();
    expect(audit().map(a => a.action)).toEqual([`ADMIN_DELETE_${NAME[type]}`]);
  });

  it('404s an unknown ID', async () => {
    for (const req of [
      request(app).post(`/api/admin/${type}/99999/block`),
      request(app).post(`/api/admin/${type}/99999/unblock`),
      request(app).delete(`/api/admin/${type}/99999`)
    ]) expect((await as(req)).status).toBe(404);
  });

  it('keeps non-admins out (redirect, nothing changes)', async () => {
    const item = MAKE[type]();
    const user = JSON.stringify({ id: owner.id, isAdmin: 0 });

    expect((await as(request(app).post(`/api/admin/${type}/${item.id}/block`), user)).status).toBe(302);
    expect((await as(request(app).delete(`/api/admin/${type}/${item.id}`), user)).status).toBe(302);
    expect((await request(app).post(`/api/admin/${type}/${item.id}/block`)).status).toBe(302);
    expect(row(type, item.id).isBlocked).toBe(0);
  });

  it('bulk-blocks and bulk-unblocks, reporting IDs it could not find', async () => {
    const a = MAKE[type]();
    const b = MAKE[type]();

    const blocked = await as(request(app).post(`/api/admin/${type}/bulk-block`).send({ ids: [a.id, b.id, 99999] }));
    expect(blocked.body).toEqual({ success: true, blocked: 2, errors: ['99999: not found'] });
    expect([row(type, a.id).isBlocked, row(type, b.id).isBlocked]).toEqual([1, 1]);
    expect(JSON.parse(audit()[0].details)).toEqual(expect.objectContaining({ bulk: true }));

    const unblocked = await as(request(app).post(`/api/admin/${type}/bulk-unblock`).send({ ids: [a.id] }));
    expect(unblocked.body).toEqual({ success: true, unblocked: 1, errors: [] });
    expect([row(type, a.id).isBlocked, row(type, b.id).isBlocked]).toEqual([0, 1]);
  });

  it('refuses a bulk request without IDs or with more than 200', async () => {
    for (const body of [{}, { ids: [] }, { ids: 'all' }, { ids: Array.from({ length: 201 }, (_, i) => i + 1) }]) {
      expect((await as(request(app).post(`/api/admin/${type}/bulk-block`).send(body))).status).toBe(400);
    }
  });
});

it('deleting a file also removes the stored upload', async () => {
  const file = MAKE.file();
  const stored = path.join(paths.UPLOADS_DIR, file.storedName);
  fs.mkdirSync(paths.UPLOADS_DIR, { recursive: true });
  fs.writeFileSync(stored, 'bytes');

  await as(request(app).delete(`/api/admin/file/${file.id}`));

  expect(fs.existsSync(stored)).toBe(false);
});

it.each([['bundle', 'bundles'], ['paste', 'pastes'], ['file', 'files']])(
  '%s routes are 404 while features.%s is off',
  async (type, feature) => {
    const item = MAKE[type]();
    fs.writeFileSync(paths.SETTINGS_PATH, JSON.stringify({ features: { [feature]: false } }));
    configService.reload();

    expect((await as(request(app).post(`/api/admin/${type}/${item.id}/block`))).status).toBe(404);
    expect((await as(request(app).delete(`/api/admin/${type}/${item.id}`))).status).toBe(404);
    expect(row(type, item.id)).toEqual(expect.objectContaining({ isBlocked: 0 }));
  }
);

it('passes other admin addresses through (users, reports, …)', async () => {
  const res = await as(request(app).delete(`/api/admin/users/${owner.id}`));
  expect(res.body).toEqual({ notFound: true });
});

it('the old per-type addresses are gone', async () => {
  app = makeApp(['adminItemRoutes', 'adminRoutes', 'bundleRoutes', 'pasteRoutes', 'fileRoutes']);
  const url = MAKE.url();
  for (const req of [
    request(app).post(`/api/admin/urls/${url.id}/block`),
    request(app).post('/api/admin/urls/bulk-block').send({ ids: [url.id] }),
    request(app).post(`/api/admin/bundles/${url.id}/block`),
    request(app).delete(`/api/admin/pastes/${url.id}`),
    request(app).post(`/api/admin/files/${url.id}/unblock`)
  ]) expect((await as(req)).body).toEqual({ notFound: true });
  expect(row('url', url.id).isBlocked).toBe(0);
});
