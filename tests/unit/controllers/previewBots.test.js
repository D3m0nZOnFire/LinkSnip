const fs = require('fs');
const path = require('path');
const paths = require('../../../config/paths');
const UrlController = require('../../../controllers/urlController');
const BundleController = require('../../../controllers/bundleController');
const BundleAnalyticsController = require('../../../controllers/bundleAnalyticsController');
const pasteController = require('../../../controllers/pasteController');
const fileController = require('../../../controllers/fileController');
const AnalyticsService = require('../../../services/analyticsService');
const { getTestDatabase } = require('../../setup/testDatabase');
const {
  createTestUser, createTestUrl, createTestBundle, createTestBundleItem, createTestPaste, createTestFile,
  createMockRequest, createMockResponse
} = require('../../setup/testHelpers');

/**
 * A chat app (WhatsApp, Telegram, Slack, …) fetches a shared link once to build its preview. That fetch is not a
 * visit: it must not count a click/view/download, record an analytics event or use up a usage limit (a paste
 * limited to one view would be gone before the recipient opens it), and it gets no paste content.
 */
const WHATSAPP = 'WhatsApp/2.23.20.0 A';
const BROWSER = 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0';
const SECRET = 'the parts list: 4 resistors';

const settle = () => new Promise(resolve => setImmediate(resolve));
const db = () => getTestDatabase();
const events = () => db().prepare('SELECT targetType, targetId, subTargetId FROM analytics_events').all();
const used = (table, column, id) => db().prepare(`SELECT ${column} AS n FROM ${table} WHERE id = ?`).get(id).n;

const visit = (params, userAgent, extra = {}) => createMockRequest({
  params, session: {}, originalUrl: '/x', get: () => 'localhost',
  headers: { 'user-agent': userAgent }, ...extra
});
const bot = (params, extra) => visit(params, WHATSAPP, extra);
const person = (params, extra) => visit(params, BROWSER, extra);

async function call(handler, req) {
  const res = createMockResponse();
  res.download = jest.fn();
  res.set = jest.fn();
  res.type = jest.fn(() => res);
  res.setHeader = jest.fn();
  await handler(req, res);
  await settle();
  return res;
}

let owner;
beforeEach(async () => { owner = await createTestUser({ username: 'owner' }); });

describe('a preview bot opening a short link (/s/:slug)', () => {
  it('follows the redirect (so the preview shows the destination) without counting a click', async () => {
    const url = createTestUrl({ slug: 'it', longUrl: 'https://dest.example/page' });
    const res = await call(UrlController.redirect, bot({ slug: 'it' }));
    expect(res.redirect).toHaveBeenCalledWith(302, 'https://dest.example/page');
    expect(used('urls', 'clicks', url.id)).toBe(0);
    expect(events()).toEqual([]);
  });

  it('leaves a one-use link for the person it was sent to', async () => {
    const url = createTestUrl({ slug: 'it', longUrl: 'https://dest.example/', maxUses: 1 });
    await call(UrlController.redirect, bot({ slug: 'it' }));
    const res = await call(UrlController.redirect, person({ slug: 'it' }));
    expect(res.redirect).toHaveBeenCalledWith(302, 'https://dest.example/');
    expect(used('urls', 'clicks', url.id)).toBe(1);
  });

  it('is refused like anyone else (no bypass)', async () => {
    createTestUrl({ slug: 'it', isBlocked: 1 });
    const res = await call(UrlController.redirect, bot({ slug: 'it' }));
    expect(res.statusCode).toBe(403);
    expect(res.redirect).not.toHaveBeenCalled();
  });
});

describe('a preview bot opening a bundle (/b/:slug)', () => {
  it('gets the page without counting a launch', async () => {
    const bundle = createTestBundle({ slug: 'it' });
    const res = await call(BundleController.launchBundle, bot({ slug: 'it' }));
    expect(res._view).toBe('bundle-launcher');
    expect(used('bundles', 'clicks', bundle.id)).toBe(0);
    expect(events()).toEqual([]);
  });

  it('leaves a one-use bundle for the person it was sent to', async () => {
    createTestBundle({ slug: 'it', maxUses: 1 });
    await call(BundleController.launchBundle, bot({ slug: 'it' }));
    expect((await call(BundleController.launchBundle, person({ slug: 'it' })))._view).toBe('bundle-launcher');
  });
});

describe('a preview bot opening a bundle item (/bt/:itemId)', () => {
  it('follows the redirect without recording a click', async () => {
    const bundle = createTestBundle({ slug: 'it' });
    const item = createTestBundleItem(bundle.id, { url: 'https://dest.example/a' });
    const res = await call(BundleAnalyticsController.trackBundleItemClick, bot({ itemId: String(item.id) }));
    expect(res.redirect).toHaveBeenCalledWith('https://dest.example/a');
    expect(events()).toEqual([]);
  });
});

describe('a preview bot opening a paste (/p/:slug)', () => {
  it('gets the page without counting a view', async () => {
    const paste = createTestPaste(owner.id, { slug: 'it', content: SECRET });
    const res = await call(pasteController.view, bot({ slug: 'it' }));
    expect(res._view).toBe('paste-view');
    expect(used('pastes', 'views', paste.id)).toBe(0);
    expect(events()).toEqual([]);
  });

  it('gets no paste content, only what describes it', async () => {
    createTestPaste(owner.id, { slug: 'it', title: 'Parts list', content: SECRET });
    const res = await call(pasteController.view, bot({ slug: 'it' }));
    expect(JSON.stringify(res._viewData)).not.toContain('4 resistors');
    expect(res._viewData.paste.title).toBe('Parts list');
  });

  it('leaves a one-view paste for the person it was sent to', async () => {
    const paste = createTestPaste(owner.id, { slug: 'it', content: SECRET, maxViews: 1 });
    await call(pasteController.view, bot({ slug: 'it' }));
    const res = await call(pasteController.view, person({ slug: 'it' }));
    expect(res._view).toBe('paste-view');
    expect(JSON.stringify(res._viewData)).toContain('4 resistors');
    expect(used('pastes', 'views', paste.id)).toBe(1);
  });
});

describe('a preview bot opening a raw paste (/p/:slug/raw)', () => {
  it('gets no content and counts no view', async () => {
    const paste = createTestPaste(owner.id, { slug: 'it', content: SECRET, maxViews: 1 });
    const res = await call(pasteController.raw, bot({ slug: 'it' }));
    expect(String(res._sentData ?? '')).not.toContain('4 resistors');
    expect(used('pastes', 'views', paste.id)).toBe(0);
  });
});

describe('a preview bot opening a file download (/f/:slug/download)', () => {
  it('is sent to the preview page: no download counted, no file sent', async () => {
    const file = createTestFile(owner.id, { slug: 'it', storedName: 'bot.bin', maxDownloads: 1 });
    fs.mkdirSync(paths.UPLOADS_DIR, { recursive: true });
    fs.writeFileSync(path.join(paths.UPLOADS_DIR, 'bot.bin'), 'x');

    const res = await call(fileController.download, bot({ slug: 'it' }));
    expect(res.download).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith('/f/it');
    expect(used('files', 'downloads', file.id)).toBe(0);
    expect(events()).toEqual([]);
  });
});

describe('AnalyticsService.record', () => {
  it("records nothing for a preview bot's fetch", async () => {
    const url = createTestUrl({ slug: 'it' });
    expect(await AnalyticsService.record(bot({ slug: 'it' }), 'url', url.id)).toBeNull();
    expect(events()).toEqual([]);
  });
});
