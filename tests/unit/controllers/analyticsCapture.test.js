const fs = require('fs');
const path = require('path');
const paths = require('../../../config/paths');
const UrlController = require('../../../controllers/urlController');
const BundleController = require('../../../controllers/bundleController');
const BundleAnalyticsController = require('../../../controllers/bundleAnalyticsController');
const pasteController = require('../../../controllers/pasteController');
const fileController = require('../../../controllers/fileController');
const { getTestDatabase } = require('../../setup/testDatabase');
const {
  createTestUser, createTestUrl, createTestBundle, createTestBundleItem, createTestPaste, createTestFile,
  createMockRequest, createMockResponse
} = require('../../setup/testHelpers');

// Some routes record without waiting (the response goes out first)
const settle = () => new Promise(resolve => setImmediate(resolve));
const events = () => getTestDatabase()
  .prepare('SELECT targetType, targetId, subTargetId, referrer, browser, device FROM analytics_events ORDER BY id').all();

const visit = (params, extra = {}) => createMockRequest({
  params, session: {}, originalUrl: '/x', get: () => 'localhost',
  headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) Firefox/120.0', referer: 'https://news.example/' },
  ...extra
});

async function call(handler, req) {
  const res = createMockResponse();
  res.download = jest.fn();
  res.set = jest.fn();
  await handler(req, res);
  await settle();
  return res;
}

let owner;
beforeEach(async () => { owner = await createTestUser({ username: 'owner' }); });

describe('one capture path: every visit records one event of its type', () => {
  it('opening a link', async () => {
    const url = createTestUrl({ slug: 'it' });
    await call(UrlController.redirect, visit({ slug: 'it' }));
    expect(events()).toEqual([expect.objectContaining({
      targetType: 'url', targetId: url.id, subTargetId: null, referrer: 'https://news.example/', browser: 'Firefox'
    })]);
  });

  it('opening a bundle', async () => {
    const bundle = createTestBundle({ slug: 'it' });
    await call(BundleController.launchBundle, visit({ slug: 'it' }));
    expect(events()).toEqual([expect.objectContaining({ targetType: 'bundle', targetId: bundle.id, subTargetId: null })]);
  });

  it('clicking a bundle item: a sub-item event of the bundle, with the full visit details', async () => {
    const bundle = createTestBundle({ slug: 'it' });
    const item = createTestBundleItem(bundle.id, { url: 'https://dest.example' });
    await call(BundleAnalyticsController.trackBundleItemClick, visit({ itemId: String(item.id) }));
    expect(events()).toEqual([expect.objectContaining({
      targetType: 'bundle', targetId: bundle.id, subTargetId: item.id, browser: 'Firefox'
    })]);
  });

  it('viewing a paste', async () => {
    const paste = createTestPaste(owner.id, { slug: 'it' });
    await call(pasteController.view, visit({ slug: 'it' }));
    expect(events()).toEqual([expect.objectContaining({ targetType: 'paste', targetId: paste.id })]);
  });

  it('downloading a file (the preview page is not a download)', async () => {
    const file = createTestFile(owner.id, { slug: 'it', storedName: 'capture.bin' });
    fs.mkdirSync(paths.UPLOADS_DIR, { recursive: true });
    fs.writeFileSync(path.join(paths.UPLOADS_DIR, 'capture.bin'), 'x');

    await call(fileController.preview, visit({ slug: 'it' }));
    expect(events()).toEqual([]);

    await call(fileController.download, visit({ slug: 'it' }));
    expect(events()).toEqual([expect.objectContaining({ targetType: 'file', targetId: file.id, device: 'Desktop' })]);
  });

  it('records nothing when access is refused', async () => {
    createTestUrl({ slug: 'it', isBlocked: 1 });
    createTestPaste(owner.id, { slug: 'it', password: 'hash' });
    await call(UrlController.redirect, visit({ slug: 'it' }));
    await call(pasteController.view, visit({ slug: 'it' }));
    expect(events()).toEqual([]);
  });
});
