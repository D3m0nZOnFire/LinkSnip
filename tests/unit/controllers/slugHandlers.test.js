const fs = require('fs');
const express = require('express');
const request = require('supertest');
const paths = require('../../../config/paths');
const configService = require('../../../services/configService');
const UrlController = require('../../../controllers/urlController');
const BundleController = require('../../../controllers/bundleController');
const pasteController = require('../../../controllers/pasteController');
const fileController = require('../../../controllers/fileController');
const Url = require('../../../models/Url');
const Bundle = require('../../../models/Bundle');
const Paste = require('../../../models/Paste');
const File = require('../../../models/File');
const { getTestDatabase } = require('../../setup/testDatabase');
const {
  createTestUser, createTestUrl, createTestBundle, createTestPaste, createTestFile, createMockRequest, createMockResponse
} = require('../../setup/testHelpers');

// Every type's short link can be chosen on create and changed on edit, behind the customSlugs permission.
// Slugs are unique per type, ignoring case: /s/thing and /b/thing can both exist, /s/Thing and /s/thing can't.

const ITEMS = [{ url: 'https://a.example' }, { url: 'https://b.example' }];

let owner, user, admin;
beforeEach(async () => {
  const o = await createTestUser({ username: 'owner', email: 'o@example.com', role: 'trusted' });
  owner = o;
  user = { id: o.id, username: 'owner', isAdmin: 0, role: 'trusted' };
  const a = await createTestUser({ username: 'admin', email: 'a@example.com', isAdmin: 1 });
  admin = { id: a.id, username: 'admin', isAdmin: 1, role: null };
});

afterEach(() => {
  fs.rmSync(paths.ROLES_PATH, { force: true });
  configService.reload();
  fs.rmSync(paths.UPLOADS_DIR, { recursive: true, force: true });
  fs.mkdirSync(paths.UPLOADS_DIR, { recursive: true });
});

// trusted without customSlugs
function withoutCustomSlugs() {
  fs.writeFileSync(paths.ROLES_PATH, JSON.stringify({ roles: { trusted: { permissions: { customSlugs: false } } } }));
  configService.reload();
}

async function call(handler, { params = {}, body = {}, asUser = user } = {}) {
  const res = createMockResponse();
  await handler(createMockRequest({
    params, body, user: asUser, session: asUser ? { userId: asUser.id, isAdmin: !!(asUser && asUser.isAdmin) } : {},
    protocol: 'http', get: () => 'localhost'
  }), res);
  return res;
}

function fileApp(asUser = user) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = asUser;
    req.session = { userId: asUser.id, isAdmin: !!asUser.isAdmin };
    next();
  });
  app.use(require('../../../routes/fileRoutes'));
  return app;
}

// Per type: create (returns { status, slug, error }), update (by id), the stored record, a record made directly
const TYPES = {
  url: {
    async create(body, asUser) {
      const res = await call(UrlController.createShortUrl, { body: { longUrl: 'https://example.com', ...body }, asUser });
      const data = res._viewData || {};
      return { status: res.statusCode, slug: data.success && data.success.slug, error: data.error };
    },
    update: (id, body, asUser) => call(UrlController.updateUrl, { params: { id }, body, asUser }),
    find: (id) => Url.findById(id),
    make: (slug, creatorId = owner.id) => createTestUrl({ slug, creatorId })
  },
  bundle: {
    async create(body, asUser) {
      const res = await call(BundleController.createBundle, { body: { title: 'B', items: ITEMS, ...body }, asUser });
      return { status: res.statusCode, slug: res._jsonData && res._jsonData.slug, error: res._jsonData && res._jsonData.error };
    },
    update: (id, body, asUser) => call(BundleController.updateBundle, { params: { id }, body: { title: 'B', items: ITEMS, ...body }, asUser }),
    find: (id) => Bundle.findById(id),
    make: (slug, creatorId = owner.id) => createTestBundle({ slug, creatorId })
  },
  paste: {
    async create(body, asUser) {
      const res = await call(pasteController.create, { body: { content: 'hi', ...body }, asUser });
      return { status: res.statusCode, slug: res._jsonData && res._jsonData.slug, error: res._jsonData && res._jsonData.error };
    },
    update: (id, body, asUser) => call(pasteController.updateSettings, { params: { id }, body, asUser }),
    find: (id) => Paste.findById(id),
    make: (slug, userId = owner.id) => createTestPaste(userId, { slug })
  },
  file: {
    async create(body, asUser = user) {
      let req = request(fileApp(asUser)).post('/api/files/upload');
      for (const [key, value] of Object.entries(body)) req = req.field(key, value);
      const res = await req.attach('file', Buffer.from('x'), 'a.txt');
      return { status: res.status, slug: res.body.slug, error: res.body.error };
    },
    update: (id, body, asUser) => call(fileController.updateSettings, { params: { id }, body, asUser }),
    find: (id) => File.findById(id),
    make: (slug, userId = owner.id) => createTestFile(userId, { slug })
  }
};

const audit = () => getTestDatabase().prepare("SELECT * FROM audit_logs WHERE action = 'CHANGE_SLUG' ORDER BY id").all();

describe.each(Object.keys(TYPES))('%s', (type) => {
  const t = TYPES[type];

  describe('create', () => {
    it('uses the chosen slug (sent as slug or customSlug)', async () => {
      expect((await t.create({ customSlug: 'chosen' })).slug).toBe('chosen');
      expect((await t.create({ slug: 'other' })).slug).toBe('other');
    });

    it('makes a random slug when none is chosen', async () => {
      expect((await t.create({})).slug).toMatch(/^[A-Za-z0-9_-]{5}$/);
    });

    it('refuses a slug taken in the same type, in any case (400)', async () => {
      t.make('Taken');
      const result = await t.create({ customSlug: 'taken' });
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/already taken/);
    });

    it('allows a slug that another type uses', async () => {
      for (const other of Object.keys(TYPES).filter(o => o !== type)) TYPES[other].make('shared');
      expect((await t.create({ customSlug: 'shared' })).slug).toBe('shared');
    });

    it('refuses an invalid slug (400)', async () => {
      expect((await t.create({ customSlug: 'no spaces' })).status).toBe(400);
    });

    it('refuses a chosen slug without customSlugs (403), but creates without one', async () => {
      withoutCustomSlugs();
      expect((await t.create({ customSlug: 'chosen' })).status).toBe(403);
      expect((await t.create({})).slug).toMatch(/^[A-Za-z0-9_-]{5}$/);
    });
  });

  describe('update', () => {
    it('changes the slug and logs CHANGE_SLUG with the old and new slug', async () => {
      const item = t.make('before');
      const res = await t.update(item.id, { slug: 'after' });
      expect(res.statusCode).toBe(200);
      expect(t.find(item.id).slug).toBe('after');
      const [entry] = audit();
      expect(entry).toEqual(expect.objectContaining({ category: 'ACCOUNT_CHANGE', targetType: type, targetId: item.id }));
      expect(JSON.parse(entry.details)).toEqual({ from: 'before', to: 'after' });
    });

    it('accepts customSlug as the field name too', async () => {
      const item = t.make('before');
      await t.update(item.id, { customSlug: 'after' });
      expect(t.find(item.id).slug).toBe('after');
    });

    it('may change only the case of its own slug', async () => {
      const item = t.make('promo');
      await t.update(item.id, { slug: 'Promo' });
      expect(t.find(item.id).slug).toBe('Promo');
    });

    it('refuses a slug another item of the type has, in any case (400), and keeps the old one', async () => {
      t.make('other');
      const item = t.make('mine');
      const res = await t.update(item.id, { slug: 'OTHER' });
      expect(res.statusCode).toBe(400);
      expect(t.find(item.id).slug).toBe('mine');
      expect(audit()).toHaveLength(0);
    });

    it('without customSlugs: a new slug is refused (403), the stored one sent back is fine', async () => {
      withoutCustomSlugs();
      const item = t.make('mine');
      expect((await t.update(item.id, { slug: 'new' })).statusCode).toBe(403);
      expect(t.find(item.id).slug).toBe('mine');
      expect((await t.update(item.id, { slug: 'mine' })).statusCode).toBe(200);
      expect(audit()).toHaveLength(0);
    });

    it('not sending a slug keeps it', async () => {
      const item = t.make('mine');
      await t.update(item.id, {});
      expect(t.find(item.id).slug).toBe('mine');
    });

    it("an admin changing someone else's slug is an admin action", async () => {
      const item = t.make('mine');
      await t.update(item.id, { slug: 'theirs' }, admin);
      expect(t.find(item.id).slug).toBe('theirs');
      expect(audit()[0].category).toBe('ADMIN_ACTION');
    });
  });
});

describe('public addresses ignore case', () => {
  it('a link opens by its slug in any case', async () => {
    createTestUrl({ slug: 'Promo', longUrl: 'https://promo.example' });
    const res = createMockResponse();
    await UrlController.redirect(createMockRequest({ params: { slug: 'PROMO' } }), res);
    expect(res.redirect).toHaveBeenCalledWith(302, 'https://promo.example');
    expect(Url.findBySlug('promo').clicks).toBe(1);
  });

  it.each([
    ['Url', () => Url, (slug) => createTestUrl({ slug })],
    ['Bundle', () => Bundle, (slug) => createTestBundle({ slug })],
    ['Paste', () => Paste, (slug) => createTestPaste(owner.id, { slug })],
    ['File', () => File, (slug) => createTestFile(owner.id, { slug })]
  ])('%s.findBySlug ignores case', (_name, model, make) => {
    const item = make('Promo');
    expect(model().findBySlug('pROMO').id).toBe(item.id);
  });

  it('bundle clicks count by slug in any case', () => {
    const bundle = createTestBundle({ slug: 'Promo' });
    Bundle.incrementClicks('promo');
    expect(Bundle.findById(bundle.id).clicks).toBe(1);
  });
});
