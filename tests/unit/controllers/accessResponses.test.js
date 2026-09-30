const UrlController = require('../../../controllers/urlController');
const BundleController = require('../../../controllers/bundleController');
const InfoController = require('../../../controllers/infoController');
const pasteController = require('../../../controllers/pasteController');
const fileController = require('../../../controllers/fileController');
const unlockController = require('../../../controllers/unlockController');
const { getTestDatabase } = require('../../setup/testDatabase');
const {
  createTestUser, createTestUrl, createTestBundle, createTestPaste, createTestFile,
  createMockRequest, createMockResponse
} = require('../../setup/testHelpers');

const PAST = '2000-01-01T00:00:00.000Z';
const FUTURE = '2999-01-01T00:00:00.000Z';

const visit = (slug, extra = {}) =>
  createMockRequest({ params: { slug }, session: {}, originalUrl: `/x/${slug}`, get: () => undefined, ...extra });

async function call(handler, req) {
  const res = createMockResponse();
  await handler(req, res);
  return res;
}

let owner;
beforeEach(async () => {
  owner = await createTestUser({ username: 'owner' });
});

// Each public route, with a way to create a record of its type
const ROUTES = {
  'GET /s/:slug': {
    make: (f) => createTestUrl({ slug: 'it', ...rename(f, 'clicks', 'maxUses') }),
    handler: UrlController.redirect
  },
  'GET /b/:slug': {
    make: (f) => createTestBundle({ slug: 'it', ...rename(f, 'clicks', 'maxUses') }),
    handler: BundleController.launchBundle
  },
  'GET /p/:slug': {
    make: (f) => createTestPaste(owner.id, { slug: 'it', ...rename(f, 'views', 'maxViews') }),
    handler: pasteController.view
  },
  'GET /p/:slug/raw': {
    make: (f) => createTestPaste(owner.id, { slug: 'it', ...rename(f, 'views', 'maxViews') }),
    handler: pasteController.raw
  },
  'GET /f/:slug': {
    make: (f) => createTestFile(owner.id, { slug: 'it', ...rename(f, 'downloads', 'maxDownloads') }),
    handler: fileController.preview
  },
  'GET /f/:slug/download': {
    make: (f) => createTestFile(owner.id, { slug: 'it', ...rename(f, 'downloads', 'maxDownloads') }),
    handler: fileController.download
  }
};

function rename({ used, limit, ...rest }, usedCol, limitCol) {
  const out = { ...rest };
  if (used !== undefined) out[usedCol] = used;
  if (limit !== undefined) out[limitCol] = limit;
  return out;
}

describe.each(Object.keys(ROUTES))('%s refuses the same way as every other type', (route) => {
  const { make, handler } = ROUTES[route];

  it('blocked → 403', async () => {
    make({ isBlocked: 1 });
    const res = await call(handler, visit('it'));
    expect(res.statusCode).toBe(403);
    expect(res._view).toBe('error');
  });

  it('scheduled → 404 on the scheduled page', async () => {
    make({ activateAt: FUTURE });
    const res = await call(handler, visit('it'));
    expect(res.statusCode).toBe(404);
    expect(res._view).toBe('scheduled');
  });

  it('expired → 410', async () => {
    make({ expiresAt: PAST });
    const res = await call(handler, visit('it'));
    expect(res.statusCode).toBe(410);
    expect(res._view).toBe('error');
  });

  it('deactivated → 410', async () => {
    make({ deactivateAt: PAST });
    expect((await call(handler, visit('it'))).statusCode).toBe(410);
  });

  it('limit reached → 410, and nothing is counted', async () => {
    const record = make({ used: 2, limit: 2 });
    const res = await call(handler, visit('it'));
    expect(res.statusCode).toBe(410);
    expect(res._viewData.message).toMatch(/usage limit/);
    expect(res.redirect).not.toHaveBeenCalled();
    expect(res.send).not.toHaveBeenCalled();

    const table = { 'GET /s/:slug': 'urls', 'GET /b/:slug': 'bundles' }[route]
      || (route.startsWith('GET /p') ? 'pastes' : 'files');
    const usedCol = { urls: 'clicks', bundles: 'clicks', pastes: 'views', files: 'downloads' }[table];
    expect(getTestDatabase().prepare(`SELECT ${usedCol} AS n FROM ${table} WHERE id = ?`).get(record.id).n).toBe(2);
  });
});

describe('password redirects go to the shared unlock page', () => {
  it.each([
    ['url', () => createTestUrl({ slug: 'it', password: 'hash' }), UrlController.redirect, '/unlock/url/it'],
    ['bundle', () => createTestBundle({ slug: 'it', password: 'hash' }), BundleController.launchBundle, '/unlock/bundle/it'],
    ['paste', () => createTestPaste(owner.id, { slug: 'it', password: 'hash' }), pasteController.view, '/unlock/paste/it'],
    ['file', () => createTestFile(owner.id, { slug: 'it', password: 'hash' }), fileController.preview, '/unlock/file/it']
  ])('%s → %s', async (_type, make, handler, target) => {
    make();
    expect((await call(handler, visit('it'))).redirect).toHaveBeenCalledWith(target);
  });
});

describe('restricted files', () => {
  it('sends visitors who are not logged in to the login page and back', async () => {
    createTestFile(owner.id, { slug: 'it', sharingMode: 'restricted', allowedUsers: '[]' });
    const res = await call(fileController.download, visit('it', { originalUrl: '/f/it/download' }));
    expect(res.redirect).toHaveBeenCalledWith(`/login?next=${encodeURIComponent('/f/it/download')}`);
  });

  it('refuses users who are not on the list with a 403', async () => {
    createTestFile(owner.id, { slug: 'it', sharingMode: 'restricted', allowedUsers: '[]' });
    const res = await call(fileController.preview, visit('it', { user: { id: 999, isAdmin: 0 } }));
    expect(res.statusCode).toBe(403);
  });
});

describe('unlock pages refuse unavailable records the same way', () => {
  it('a scheduled link → 404 scheduled page', async () => {
    createTestUrl({ slug: 'it', password: 'hash', activateAt: FUTURE });
    const res = await call(unlockController.showUnlockPage, visit('it', { params: { type: 'url', slug: 'it' } }));
    expect(res.statusCode).toBe(404);
    expect(res._view).toBe('scheduled');
  });

  it('a blocked link → 403', async () => {
    createTestUrl({ slug: 'it', password: 'hash', isBlocked: 1 });
    expect((await call(unlockController.showUnlockPage, visit('it', { params: { type: 'url', slug: 'it' } }))).statusCode).toBe(403);
  });

  it.each([
    ['paste', () => createTestPaste(owner.id, { slug: 'it', password: 'hash', expiresAt: PAST })],
    ['file', () => createTestFile(owner.id, { slug: 'it', password: 'hash', expiresAt: PAST })],
    ['bundle', () => createTestBundle({ slug: 'it', password: 'hash', expiresAt: PAST })]
  ])('an expired %s → 410 instead of a password prompt', async (type, make) => {
    make();
    const res = await call(unlockController.showUnlockPage, visit('it', { params: { type, slug: 'it' } }));
    expect(res.statusCode).toBe(410);
    expect(res._view).toBe('error');
  });
});

describe('info pages get the shared status', () => {
  it('/info/:slug', async () => {
    createTestUrl({ slug: 'it', clicks: 3, maxUses: 3 });
    const res = await call(InfoController.getUrlInfo, visit('it'));
    expect(res._view).toBe('url-info');
    expect(res._viewData.validation.status).toBe('limit_reached');
  });

  it('/p-info/:slug', async () => {
    createTestPaste(owner.id, { slug: 'it', views: 3, maxViews: 3 });
    const res = await call(pasteController.showInfoPage, visit('it'));
    expect(res._view).toBe('paste-info');
    expect(res._viewData.validation.status).toBe('limit_reached');
  });

  it('/info/:slug shows a password-protected link as active (the password is shown separately)', async () => {
    createTestUrl({ slug: 'it', password: 'hash' });
    const res = await call(InfoController.getUrlInfo, visit('it'));
    expect(res._viewData.validation.status).toBe('active');
  });

  it('/info/:slug shows a quarantined link as quarantined', async () => {
    createTestUrl({ slug: 'it', isQuarantined: 1 });
    const res = await call(InfoController.getUrlInfo, visit('it'));
    expect(res._viewData.validation.status).toBe('quarantined');
  });
});
