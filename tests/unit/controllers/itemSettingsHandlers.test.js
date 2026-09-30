const fs = require('fs');
const bcrypt = require('bcrypt');
const express = require('express');
const request = require('supertest');
const paths = require('../../../config/paths');
const UrlController = require('../../../controllers/urlController');
const BundleController = require('../../../controllers/bundleController');
const pasteController = require('../../../controllers/pasteController');
const Url = require('../../../models/Url');
const Paste = require('../../../models/Paste');
const File = require('../../../models/File');
const Bundle = require('../../../models/Bundle');
const {
  createTestUser, createTestUrl, createTestBundle, createTestPaste, createTestFile, createMockRequest, createMockResponse
} = require('../../setup/testHelpers');

const STORED = {
  expiresAt: '2027-06-10T14:00:00.000Z', activateAt: '2027-01-01T09:00:00.000Z', deactivateAt: '2027-12-01T09:00:00.000Z'
};
const ITEMS = [{ url: 'https://a.example' }, { url: 'https://b.example' }];

let owner, user;
beforeEach(async () => {
  owner = await createTestUser({ username: 'owner', role: 'trusted' });
  user = { id: owner.id, username: 'owner', isAdmin: 0, role: 'trusted' };
});

async function call(handler, { params = {}, body = {}, asUser = user } = {}) {
  const res = createMockResponse();
  await handler(createMockRequest({
    params, body, user: asUser, session: asUser ? { userId: asUser.id, isAdmin: false } : {},
    protocol: 'http', get: () => 'localhost'
  }), res);
  return res;
}

describe('links', () => {
  it('create stores settings the shared way (trimmed password, UTC dates)', async () => {
    await call(UrlController.createShortUrl, { body: {
      longUrl: 'https://example.com', customSlug: 'made', maxUses: '4', password: ' pw ', activateDateTime: '2027-02-01T10:00'
    } });
    const url = Url.findBySlug('made');
    expect(url).toEqual(expect.objectContaining({ maxUses: 4, activateAt: '2027-02-01T10:00:00.000Z' }));
    expect(await bcrypt.compare('pw', url.password)).toBe(true);
  });

  it('create refuses an invalid limit with the form and a message', async () => {
    const res = await call(UrlController.createShortUrl, { body: { longUrl: 'https://example.com', customSlug: 'bad', maxUses: 'lots' } });
    expect(res.statusCode).toBe(400);
    expect(res._view).toBe('index');
    expect(res._viewData.error).toMatch(/limit/i);
    expect(Url.findBySlug('bad')).toBeUndefined();
  });

  it('update keeps what is not sent, removes what is empty', async () => {
    const url = createTestUrl({ slug: 'it', creatorId: owner.id, maxUses: 9, password: 'hash', ...STORED });

    await call(UrlController.updateUrl, { params: { id: url.id }, body: { longUrl: 'https://changed.example' } });
    expect(Url.findById(url.id)).toEqual(expect.objectContaining({
      longUrl: 'https://changed.example', maxUses: 9, password: 'hash', ...STORED
    }));

    await call(UrlController.updateUrl, { params: { id: url.id }, body: { maxUses: '', expirationDays: null, deactivateDateTime: '' } });
    expect(Url.findById(url.id)).toEqual(expect.objectContaining({ maxUses: null, expiresAt: null, deactivateAt: null, activateAt: STORED.activateAt }));
  });

  it('update refuses an invalid date with a 400', async () => {
    const url = createTestUrl({ slug: 'it', creatorId: owner.id });
    const res = await call(UrlController.updateUrl, { params: { id: url.id }, body: { activateDateTime: 'someday' } });
    expect(res.statusCode).toBe(400);
  });
});

describe('pastes', () => {
  it('create normalizes the expiry date', async () => {
    const res = await call(pasteController.create, { body: { content: 'hi', customSlug: 'pp', expiresAt: '2027-03-04', maxViews: '2' } });
    expect(res._jsonData.success).toBe(true);
    expect(Paste.findBySlug('pp')).toEqual(expect.objectContaining({ expiresAt: '2027-03-04T00:00:00.000Z', maxViews: 2 }));
  });

  it('update: the edit form sends the stored day back, which keeps the stored time', async () => {
    const paste = createTestPaste(owner.id, { slug: 'pp', maxViews: 5, ...STORED });
    await call(pasteController.updateSettings, { params: { id: paste.id }, body: {
      title: 'New title', expiresAt: '2027-06-10', maxViews: '5', activateAt: '2027-01-01T09:00'
    } });
    expect(Paste.findById(paste.id)).toEqual(expect.objectContaining({ title: 'New title', maxViews: 5, ...STORED }));
  });

  it('update: a different day replaces the expiry, empty removes it', async () => {
    const paste = createTestPaste(owner.id, { slug: 'pp', ...STORED });
    await call(pasteController.updateSettings, { params: { id: paste.id }, body: { expiresAt: '2027-07-01' } });
    expect(Paste.findById(paste.id).expiresAt).toBe('2027-07-01T00:00:00.000Z');
    await call(pasteController.updateSettings, { params: { id: paste.id }, body: { expiresAt: null } });
    expect(Paste.findById(paste.id).expiresAt).toBeNull();
  });
});

describe('bundles', () => {
  it('create stores settings the shared way', async () => {
    const res = await call(BundleController.createBundle, { body: {
      title: 'B', items: ITEMS, customSlug: 'bb', maxUses: '3', activateDateTime: '2027-02-01T10:00', expirationDays: '2'
    } });
    expect(res.statusCode).toBe(201);
    const bundle = Bundle.findBySlug('bb');
    expect(bundle).toEqual(expect.objectContaining({ maxUses: 3, activateAt: '2027-02-01T10:00:00.000Z' }));
    expect((new Date(bundle.expiresAt) - Date.now()) / 86400000).toBeCloseTo(2, 1);
  });

  it('create refuses an invalid limit', async () => {
    const res = await call(BundleController.createBundle, { body: { title: 'B', items: ITEMS, customSlug: 'bb', maxUses: '-3' } });
    expect(res.statusCode).toBe(400);
    expect(Bundle.findBySlug('bb')).toBeUndefined();
  });
});

describe('files', () => {
  // Upload goes through multer: mount the real routes
  function makeApp() {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.user = user;
      req.session = { userId: user.id, isAdmin: false };
      next();
    });
    app.use(require('../../../routes/fileRoutes'));
    return app;
  }
  afterEach(() => {
    fs.rmSync(paths.UPLOADS_DIR, { recursive: true, force: true });
    fs.mkdirSync(paths.UPLOADS_DIR, { recursive: true });
  });

  it('upload parses the dates instead of storing them as sent', async () => {
    const res = await request(makeApp()).post('/api/files/upload')
      .field('expiresAt', '2027-05-06').field('activateAt', '2027-02-01T10:00').field('maxDownloads', '3')
      .attach('file', Buffer.from('x'), 'a.txt');
    expect(res.status).toBe(200);
    expect(File.findById(res.body.file.id)).toEqual(expect.objectContaining({
      expiresAt: '2027-05-06T00:00:00.000Z', activateAt: '2027-02-01T10:00:00.000Z', maxDownloads: 3
    }));
  });

  it('upload refuses an unreadable date and leaves nothing behind', async () => {
    const res = await request(makeApp()).post('/api/files/upload')
      .field('activateAt', 'whenever').attach('file', Buffer.from('x'), 'a.txt');
    expect(res.status).toBe(400);
    expect(fs.readdirSync(paths.UPLOADS_DIR)).toEqual([]);
  });

  it('update keeps the stored expiry when the form sends its day back', async () => {
    const file = createTestFile(owner.id, { slug: 'ff', maxDownloads: 4, ...STORED });
    const res = await request(makeApp()).patch(`/api/files/${file.id}`).send({ expiresAt: '2027-06-10', maxDownloads: '4' });
    expect(res.status).toBe(200);
    expect(File.findById(file.id)).toEqual(expect.objectContaining({ maxDownloads: 4, ...STORED }));
  });
});
