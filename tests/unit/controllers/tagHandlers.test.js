const fs = require('fs');
const express = require('express');
const request = require('supertest');
const paths = require('../../../config/paths');
const UrlController = require('../../../controllers/urlController');
const BundleController = require('../../../controllers/bundleController');
const pasteController = require('../../../controllers/pasteController');
const Tag = require('../../../models/Tag');
const Url = require('../../../models/Url');
const Bundle = require('../../../models/Bundle');
const Paste = require('../../../models/Paste');
const {
  createTestUser, createTestUrl, createTestBundle, createTestPaste, createTestFile, createMockRequest, createMockResponse
} = require('../../setup/testHelpers');

// Creating and editing any content type with tags: the tags are stored on the item,
// a new list replaces them, an empty one removes them all (links kept theirs before),
// and they are always the owner's tags, also when an admin edits the item.

const ITEMS = [{ url: 'https://a.example' }, { url: 'https://b.example' }];

let owner, ownerUser, admin, adminUser;
beforeEach(async () => {
  owner = await createTestUser({ username: 'owner', email: 'owner@example.com', role: 'trusted' });
  ownerUser = { id: owner.id, username: 'owner', isAdmin: 0, role: 'trusted' };
  admin = await createTestUser({ username: 'admin', email: 'admin@example.com', isAdmin: 1 });
  adminUser = { id: admin.id, username: 'admin', isAdmin: 1, role: null };
});
afterEach(() => {
  fs.rmSync(paths.UPLOADS_DIR, { recursive: true, force: true });
  fs.mkdirSync(paths.UPLOADS_DIR, { recursive: true });
});

async function call(handler, { params = {}, body = {}, asUser = ownerUser } = {}) {
  const res = createMockResponse();
  await handler(createMockRequest({
    params, body, user: asUser, session: { userId: asUser.id, isAdmin: !!asUser.isAdmin },
    protocol: 'http', get: () => 'localhost'
  }), res);
  return res;
}

function fileApp(asUser) {
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

// Per type: create an item with tags (returns its ID), and update one
const TYPES = {
  url: {
    create: async (tags) => {
      await call(UrlController.createShortUrl, { body: { longUrl: 'https://example.com', customSlug: 'made', tags } });
      return Url.findBySlug('made').id;
    },
    existing: () => createTestUrl({ slug: 'it', creatorId: owner.id }),
    update: (id, body, asUser) => call(UrlController.updateUrl, { params: { id }, body, asUser })
  },
  bundle: {
    create: async (tags) => {
      await call(BundleController.createBundle, { body: { title: 'B', items: ITEMS, customSlug: 'made', tags } });
      return Bundle.findBySlug('made').id;
    },
    existing: () => createTestBundle({ slug: 'it', creatorId: owner.id }),
    update: (id, body, asUser) =>
      call(BundleController.updateBundle, { params: { id }, body: { title: 'B', items: ITEMS, ...body }, asUser })
  },
  paste: {
    create: async (tags) => {
      await call(pasteController.create, { body: { content: 'hi', customSlug: 'made', tags } });
      return Paste.findBySlug('made').id;
    },
    existing: () => createTestPaste(owner.id, { slug: 'it' }),
    update: (id, body, asUser) => call(pasteController.updateSettings, { params: { id }, body, asUser })
  },
  file: {
    create: async (tags) => {
      const res = await request(fileApp(ownerUser)).post('/api/files/upload')
        .field('tags', tags).attach('file', Buffer.from('x'), 'a.txt');
      return res.body.file.id;
    },
    existing: () => createTestFile(owner.id, { slug: 'it' }),
    update: async (id, body, asUser = ownerUser) => {
      const res = await request(fileApp(asUser)).patch(`/api/files/${id}`).send(body);
      return { statusCode: res.status, _jsonData: res.body };
    }
  }
};

const tagNames = (type, id) => Tag.forItem(type, id).map(t => t.name);

describe.each(Object.keys(TYPES))('%s tags', (type) => {
  const t = TYPES[type];

  it('create stores the tags', async () => {
    const id = await t.create('work, Fun');
    expect(tagNames(type, id)).toEqual(['fun', 'work']);
  });

  it('update replaces the tags', async () => {
    const item = t.existing();
    Tag.setForItem(type, item.id, ['old', 'keep']);

    const res = await t.update(item.id, { tags: 'keep,new' });

    expect(res.statusCode).toBe(200);
    expect(tagNames(type, item.id)).toEqual(['keep', 'new']);
  });

  it('update with an empty tag list removes them all', async () => {
    const item = t.existing();
    Tag.setForItem(type, item.id, ['old']);

    await t.update(item.id, { tags: '' });

    expect(tagNames(type, item.id)).toEqual([]);
  });

  it('update without tags keeps them', async () => {
    const item = t.existing();
    Tag.setForItem(type, item.id, ['old']);

    await t.update(item.id, {});

    expect(tagNames(type, item.id)).toEqual(['old']);
  });

  it("an admin's edit uses the owner's tags", async () => {
    const item = t.existing();
    Tag.create('work', admin.id);

    await t.update(item.id, { tags: 'work' }, adminUser);

    expect(Tag.forItem(type, item.id)).toEqual([expect.objectContaining({ name: 'work', userId: owner.id })]);
    expect(Tag.findByUserId(admin.id).map(tag => tag.name)).toEqual(['work']);
  });
});

describe('reading an item for its edit form returns its tags', () => {
  // The edit forms fill their tag input from these; without tags, saving would remove them
  it('GET /api/urls/:id', async () => {
    const url = createTestUrl({ slug: 'tagged', creatorId: owner.id });
    Tag.setForItem('url', url.id, ['launch', 'docs']);
    const res = await call(UrlController.getUrlById, { params: { id: String(url.id) } });
    expect(res._jsonData.tags.map(t => t.name).sort()).toEqual(['docs', 'launch']);
  });

  it('GET /api/bundles/:id', async () => {
    const bundle = createTestBundle({ slug: 'kit', creatorId: owner.id });
    Tag.setForItem('bundle', bundle.id, ['launch']);
    const res = await call(BundleController.getBundleById, { params: { id: String(bundle.id) } });
    expect(res._jsonData.tags.map(t => t.name)).toEqual(['launch']);
  });
});
