const fs = require('fs');
const express = require('express');
const request = require('supertest');
const paths = require('../../../config/paths');
const configService = require('../../../services/configService');
const UrlController = require('../../../controllers/urlController');
const PasteController = require('../../../controllers/pasteController');
const BundleController = require('../../../controllers/bundleController');
const FileController = require('../../../controllers/fileController');
const BioPageController = require('../../../controllers/bioPageController');
const { getTestDatabase } = require('../../setup/testDatabase');
const {
  createTestUser, createTestUrl, createTestPaste, createTestBundle, createTestFile,
  createMockRequest, createMockResponse
} = require('../../setup/testHelpers');

// Roles used below: `user` loses the three gated features, `trusted` keeps them.
function revokeFromUser(...perms) {
  const permissions = Object.fromEntries(perms.map(p => [p, false]));
  fs.writeFileSync(paths.ROLES_PATH, JSON.stringify({ roles: { user: { permissions } } }));
  configService.reload();
}

afterEach(() => {
  fs.rmSync(paths.ROLES_PATH, { force: true });
  configService.reload();
});

function makeReq(user, body = {}, params = {}) {
  return createMockRequest({
    user,
    session: user ? { userId: user.id, isAdmin: !!user.isAdmin } : {},
    body,
    params,
    protocol: 'http',
    get: () => 'localhost'
  });
}

const count = (table) => getTestDatabase().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

const FUTURE = '2099-01-01T10:00';

// Each gated field, the permission behind it, and a body that uses it.
const GATED = [
  ['passwordProtection', { password: 'secret1' }],
  ['scheduling', { activateDateTime: FUTURE }],
  ['tags', { tags: 'work' }]
];

describe('role permissions in content handlers', () => {
  describe('URL creation (POST /create)', () => {
    it.each(GATED)('rejects %s for a role without it, creating nothing', async (perm, extra) => {
      revokeFromUser(perm);
      const user = await createTestUser({ username: 'u' });
      const res = createMockResponse();

      await UrlController.createShortUrl(makeReq(user, { longUrl: 'https://example.com', ...extra }), res);

      expect(res.statusCode).toBe(403);
      expect(res._view).toBe('index');
      expect(res._viewData.error).toEqual(expect.any(String));
      expect(count('urls')).toBe(0);
    });

    it.each(GATED)('rejects %s for anonymous visitors', async (perm, extra) => {
      const res = createMockResponse();

      await UrlController.createShortUrl(makeReq(null, { longUrl: 'https://example.com', ...extra }), res);

      expect(res.statusCode).toBe(403);
      expect(count('urls')).toBe(0);
    });

    it('allows the features for a role that has them', async () => {
      revokeFromUser('passwordProtection', 'scheduling', 'tags');
      const user = await createTestUser({ username: 't', role: 'trusted' });
      const res = createMockResponse();

      await UrlController.createShortUrl(makeReq(user, {
        longUrl: 'https://example.com', password: 'secret1', activateDateTime: FUTURE, tags: 'work'
      }), res);

      expect(res._viewData.error).toBeNull();
      const url = getTestDatabase().prepare('SELECT password, activateAt FROM urls').get();
      expect(url.password).toEqual(expect.any(String));
      expect(url.activateAt).toEqual(expect.any(String));
    });

    it('accepts empty gated fields from a role without them', async () => {
      revokeFromUser('passwordProtection', 'scheduling', 'tags');
      const user = await createTestUser({ username: 'u' });
      const res = createMockResponse();

      await UrlController.createShortUrl(makeReq(user, {
        longUrl: 'https://example.com', password: '', activateDateTime: '', deactivateDateTime: '', tags: ''
      }), res);

      expect(res._viewData.error).toBeNull();
      expect(count('urls')).toBe(1);
    });
  });

  describe('URL update (PUT /api/urls/:id)', () => {
    it.each(GATED)('rejects setting %s for a role without it', async (perm, extra) => {
      revokeFromUser(perm);
      const user = await createTestUser({ username: 'u' });
      const url = createTestUrl({ slug: 'abc', creatorId: user.id });
      const res = createMockResponse();

      await UrlController.updateUrl(makeReq(user, { ...extra }, { id: url.id }), res);

      expect(res.statusCode).toBe(403);
      expect(res._jsonData).toEqual(expect.objectContaining({ error: 'permission_denied', permission: perm }));
    });

    it('always allows removing a password', async () => {
      revokeFromUser('passwordProtection');
      const user = await createTestUser({ username: 'u' });
      const url = createTestUrl({ slug: 'abc', creatorId: user.id, password: 'hash' });
      const res = createMockResponse();

      await UrlController.updateUrl(makeReq(user, { removePassword: true }, { id: url.id }), res);

      expect(res.statusCode).toBe(200);
      expect(getTestDatabase().prepare('SELECT password FROM urls WHERE id = ?').get(url.id).password).toBeNull();
    });
  });

  describe('paste creation and update', () => {
    it.each(GATED)('rejects %s on create for a role without it', async (perm, extra) => {
      revokeFromUser(perm);
      const user = await createTestUser({ username: 'u' });
      const res = createMockResponse();

      await PasteController.create(makeReq(user, { content: 'hello', ...extra }), res);

      expect(res.statusCode).toBe(403);
      expect(res._jsonData).toEqual(expect.objectContaining({ error: 'permission_denied', permission: perm }));
      expect(count('pastes')).toBe(0);
    });

    it('rejects a password from anonymous visitors instead of dropping it', async () => {
      const res = createMockResponse();

      await PasteController.create(makeReq(null, { content: 'hello', password: 'secret1' }), res);

      expect(res.statusCode).toBe(403);
      expect(count('pastes')).toBe(0);
    });

    it('rejects setting a password on update for a role without it', async () => {
      revokeFromUser('passwordProtection');
      const user = await createTestUser({ username: 'u' });
      const paste = createTestPaste(user.id);
      const res = createMockResponse();

      await PasteController.updateSettings(makeReq(user, { password: 'secret1' }, { id: paste.id }), res);

      expect(res.statusCode).toBe(403);
    });
  });

  describe('bundle creation and update', () => {
    const items = [{ url: 'https://a.example' }, { url: 'https://b.example' }];

    it('returns 403 permission_denied for an anonymous password', async () => {
      const res = createMockResponse();

      await BundleController.createBundle(makeReq(null, { title: 'B', items, password: 'secret1' }), res);

      expect(res.statusCode).toBe(403);
      expect(res._jsonData).toEqual(expect.objectContaining({ permission: 'passwordProtection' }));
    });

    it('rejects scheduling on update for a role without it', async () => {
      revokeFromUser('scheduling');
      const user = await createTestUser({ username: 'u' });
      const bundle = createTestBundle({ creatorId: user.id });
      const res = createMockResponse();

      await BundleController.updateBundle(makeReq(user, { title: 'B', items, activateDateTime: FUTURE }, { id: bundle.id }), res);

      expect(res.statusCode).toBe(403);
    });
  });

  describe('file upload and update', () => {
    it('rejects a password on update for an uploader role without passwordProtection', async () => {
      fs.writeFileSync(paths.ROLES_PATH, JSON.stringify({
        roles: { uploader: { permissions: { uploadFiles: true, passwordProtection: false } } }
      }));
      configService.reload();
      const user = await createTestUser({ username: 'up', role: 'uploader' });
      const file = createTestFile(user.id);
      const res = createMockResponse();

      await FileController.updateSettings(makeReq(user, { password: 'secret1' }, { id: file.id }), res);

      expect(res.statusCode).toBe(403);
    });
  });

  describe('public bio page', () => {
    it('is not found when its owner no longer has the bioPage permission', async () => {
      revokeFromUser('bioPage');
      await createTestUser({ username: 'someone' });
      const res = createMockResponse();

      BioPageController.getBioPage(makeReq(null, {}, { username: 'someone' }), res);

      expect(res.statusCode).toBe(404);
    });
  });
});

describe('role permissions on routes', () => {
  // Mounts a router behind a fake session; the x-user header stands in for attachUser.
  function appWith(router) {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      const user = req.get('x-user') ? JSON.parse(req.get('x-user')) : null;
      req.user = user;
      req.session = user ? { userId: user.id, isAdmin: !!user.isAdmin } : {};
      next();
    });
    app.use(router);
    return app;
  }

  const user = JSON.stringify({ id: 1, role: 'user', isAdmin: 0 });

  it.each([
    ['tags', 'tagRoutes', 'get', '/api/tags'],
    ['tags', 'tagRoutes', 'put', '/api/tags/1'],
    ['analytics', 'analyticsRoutes', 'get', '/api/analytics/1'],
    ['analytics', 'bundleRoutes', 'get', '/api/bundle-analytics/1'],
    ['bioPage', 'bioPageRoutes', 'put', '/api/bio'],
    ['bioPage', 'bioPageRoutes', 'post', '/api/bio/urls/1/toggle']
  ])('%s gates %s %s %s', async (perm, routerFile, method, path) => {
    revokeFromUser(perm);
    const app = appWith(require(`../../../routes/${routerFile}`));

    const res = await request(app)[method](path).set('x-user', user).set('Accept', 'application/json');

    expect(res.status).toBe(403);
    expect(res.body).toEqual(expect.objectContaining({ permission: perm }));
  });

  it.each([
    ['tagRoutes', '/tags'],
    ['analyticsRoutes', '/analytics/1'],
    ['pasteRoutes', '/pastes/1/analytics'],
    ['bundleRoutes', '/bundle-analytics/1'],
    ['bioPageRoutes', '/bio/settings']
  ])('redirects %s %s pages home for a role without the permission', async (routerFile, path) => {
    revokeFromUser('tags', 'analytics', 'bioPage');
    const app = appWith(require(`../../../routes/${routerFile}`));

    const res = await request(app).get(path).set('x-user', user).set('Accept', 'text/html');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
  });
});
