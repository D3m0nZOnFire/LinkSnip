const UrlController = require('../../../controllers/urlController');
const BundleController = require('../../../controllers/bundleController');
const pasteController = require('../../../controllers/pasteController');
const fileController = require('../../../controllers/fileController');
const AnalyticsController = require('../../../controllers/analyticsController');
const shareController = require('../../../controllers/analyticsShareController');
const {
  createTestUser, createTestUrl, createTestBundle, createTestPaste, createTestFile, createMockRequest, createMockResponse
} = require('../../setup/testHelpers');

// Every handler that acts on one item by ID: strangers are turned away, the owner and admins get through.

let users, items;
beforeEach(async () => {
  const owner = await createTestUser({ username: 'owner', email: 'o@example.com', role: 'trusted' });
  const stranger = await createTestUser({ username: 'stranger', email: 's@example.com', role: 'trusted' });
  const admin = await createTestUser({ username: 'admin', email: 'a@example.com', isAdmin: 1 });
  users = {
    owner: { id: owner.id, username: 'owner', isAdmin: 0, role: 'trusted' },
    stranger: { id: stranger.id, username: 'stranger', isAdmin: 0, role: 'trusted' },
    admin: { id: admin.id, username: 'admin', isAdmin: 1, role: null }
  };
  items = {
    url: createTestUrl({ slug: 'u1', creatorId: owner.id }),
    bundle: createTestBundle({ slug: 'b1', creatorId: owner.id }),
    paste: createTestPaste(owner.id, { slug: 'p1' }),
    file: createTestFile(owner.id, { slug: 'f1' })
  };
});

async function call(handler, asUser, { params = {}, body = {} } = {}) {
  const res = createMockResponse();
  await handler(createMockRequest({
    params, body, user: asUser, session: { userId: asUser.id, isAdmin: !!asUser.isAdmin },
    protocol: 'http', get: () => 'localhost', query: {}
  }), res);
  return res;
}

const denied = (res) => res.statusCode === 403
  || res._redirectUrl === '/dashboard'
  || (!!res._jsonData && Array.isArray(res._jsonData.errors) && /access denied/.test(res._jsonData.errors.join()));

// [name, handler, request for the item]
const HANDLERS = [
  ['GET /api/urls/:id', UrlController.getUrlById, () => ({ params: { id: String(items.url.id) } })],
  ['PUT /api/urls/:id', UrlController.updateUrl, () => ({ params: { id: String(items.url.id) }, body: { longUrl: 'https://changed.example' } })],
  ['DELETE /api/urls/:id', UrlController.deleteUrl, () => ({ params: { id: String(items.url.id) } })],
  ['POST /api/urls/bulk-delete', UrlController.bulkDeleteUrls, () => ({ body: { ids: [items.url.id] } })],
  ['GET /api/bundles/:id', BundleController.getBundleById, () => ({ params: { id: String(items.bundle.id) } })],
  ['PUT /api/bundles/:id', BundleController.updateBundle, () => ({
    params: { id: String(items.bundle.id) }, body: { title: 'T', items: [{ url: 'https://a.example' }] }
  })],
  ['DELETE /api/bundles/:id', BundleController.deleteBundle, () => ({ params: { id: String(items.bundle.id) } })],
  ['POST /api/bundles/bulk-delete', BundleController.bulkDeleteBundles, () => ({ body: { ids: [items.bundle.id] } })],
  ['GET /api/pastes/:id', pasteController.getById, () => ({ params: { id: String(items.paste.id) } })],
  ['PATCH /api/pastes/:id', pasteController.updateSettings, () => ({ params: { id: String(items.paste.id) }, body: {} })],
  ['DELETE /api/pastes/:id', pasteController.delete, () => ({ params: { id: String(items.paste.id) } })],
  ['POST /api/pastes/bulk-delete', pasteController.bulkDelete, () => ({ body: { ids: [items.paste.id] } })],
  ['GET /pastes/:id/edit', pasteController.showEditPage, () => ({ params: { id: String(items.paste.id) } })],
  ['PATCH /api/files/:id', fileController.updateSettings, () => ({ params: { id: String(items.file.id) }, body: {} })],
  ['DELETE /api/files/:id', fileController.delete, () => ({ params: { id: String(items.file.id) } })],
  ...['url', 'bundle', 'paste', 'file'].flatMap(type => [
    [`GET /analytics/${type}/:id`, AnalyticsController.getAnalyticsPage, () => ({ params: { type, id: String(items[type].id) } })],
    [`GET /api/analytics/${type}/:id`, AnalyticsController.getAnalyticsData, () => ({ params: { type, id: String(items[type].id) } })],
    [`GET /api/share-links/${type}/:id`, shareController.listLinks, () => ({ params: { type, id: String(items[type].id) } })],
    [`POST /api/share-links/${type}/:id`, shareController.createLink, () => ({ params: { type, id: String(items[type].id) }, body: {} })]
  ])
];

describe.each(HANDLERS)('%s', (name, handler, request) => {
  it('turns strangers away', async () => {
    expect(denied(await call(handler, users.stranger, request()))).toBe(true);
  });

  it('lets the owner through', async () => {
    expect(denied(await call(handler, users.owner, request()))).toBe(false);
  });

  it('lets admins through', async () => {
    expect(denied(await call(handler, users.admin, request()))).toBe(false);
  });
});
