const Url = require('../../../models/Url');
const { createTestUrl, createTestUser, createTestTag, tagItem, createTestReport } = require('../../setup/testHelpers');
const { getTestDatabase } = require('../../setup/testDatabase');

describe('Url Model', () => {
  describe('create', () => {
    it('should create a new URL with required fields', () => {
      const url = Url.create({
        slug: 'test123',
        longUrl: 'https://example.com'
      });

      expect(url).toBeDefined();
      expect(url.id).toBeDefined();
      expect(url.slug).toBe('test123');
      expect(url.longUrl).toBe('https://example.com');
      expect(url.clicks).toBe(0);
      expect(url.isBlocked).toBe(0);
    });

    it('should create URL with all optional fields', async () => {
      const user = await createTestUser();
      const expiresAt = new Date(Date.now() + 86400000).toISOString();
      const activateAt = new Date(Date.now() - 3600000).toISOString();
      const deactivateAt = new Date(Date.now() + 172800000).toISOString();

      const url = Url.create({
        slug: 'fullurl',
        longUrl: 'https://example.com',
        creatorId: user.id,
        maxUses: 100,
        expiresAt,
        password: 'hashedpassword',
        activateAt,
        deactivateAt
      });

      expect(url.creatorId).toBe(user.id);
      expect(url.maxUses).toBe(100);
      expect(url.expiresAt).toBe(expiresAt);
      expect(url.password).toBe('hashedpassword');
      expect(url.activateAt).toBe(activateAt);
      expect(url.deactivateAt).toBe(deactivateAt);
    });
  });

  describe('findBySlug', () => {
    it('should find existing URL by slug', () => {
      createTestUrl({ slug: 'findme', longUrl: 'https://test.com' });

      const url = Url.findBySlug('findme');

      expect(url).toBeDefined();
      expect(url.slug).toBe('findme');
      expect(url.longUrl).toBe('https://test.com');
    });

    it('should return undefined for non-existent slug', () => {
      const url = Url.findBySlug('nonexistent');
      expect(url).toBeUndefined();
    });
  });

  describe('findById', () => {
    it('should find existing URL by id', () => {
      const created = createTestUrl({ slug: 'byid' });

      const url = Url.findById(created.id);

      expect(url).toBeDefined();
      expect(url.id).toBe(created.id);
    });

    it('should return undefined for non-existent id', () => {
      const url = Url.findById(99999);
      expect(url).toBeUndefined();
    });
  });

  describe('findByCreatorId', () => {
    it('should find all URLs for a creator', async () => {
      const user = await createTestUser();
      createTestUrl({ slug: 'url1', creatorId: user.id });
      createTestUrl({ slug: 'url2', creatorId: user.id });

      const urls = Url.findByCreatorId(user.id);

      expect(urls).toHaveLength(2);
    });

    it('should include tags with URLs', async () => {
      const user = await createTestUser();
      const url = createTestUrl({ slug: 'tagged', creatorId: user.id });
      const tag = createTestTag({ name: 'mytag', userId: user.id });
      tagItem('url', url.id, tag.id);

      const urls = Url.findByCreatorId(user.id);

      expect(urls[0].tags).toHaveLength(1);
      expect(urls[0].tags[0].name).toBe('mytag');
    });

    it('should support pagination', async () => {
      const user = await createTestUser();
      for (let i = 0; i < 5; i++) {
        createTestUrl({ slug: `page${i}`, creatorId: user.id });
      }

      const urls = Url.findByCreatorId(user.id, 2, 0);

      expect(urls).toHaveLength(2);
    });

    it('should include pending report count', async () => {
      const user = await createTestUser();
      const url = createTestUrl({ slug: 'reported', creatorId: user.id });
      createTestReport({ urlId: url.id, status: 'pending' });
      createTestReport({ urlId: url.id, status: 'dismissed' }); // Should not count

      const urls = Url.findByCreatorId(user.id);

      expect(urls[0].reportCount).toBe(1);
    });
  });

  describe('countByCreatorId', () => {
    it('should return 0 when no URLs exist', async () => {
      const user = await createTestUser();
      const count = Url.countByCreatorId(user.id);
      expect(count).toBe(0);
    });

    it('should return correct count', async () => {
      const user = await createTestUser();
      createTestUrl({ slug: 'c1', creatorId: user.id });
      createTestUrl({ slug: 'c2', creatorId: user.id });
      createTestUrl({ slug: 'c3', creatorId: user.id });

      const count = Url.countByCreatorId(user.id);
      expect(count).toBe(3);
    });
  });

  describe('findAll', () => {
    it('should return all URLs for admin', async () => {
      const user1 = await createTestUser({ username: 'u1' });
      const user2 = await createTestUser({ username: 'u2' });
      createTestUrl({ slug: 'all1', creatorId: user1.id });
      createTestUrl({ slug: 'all2', creatorId: user2.id });

      const urls = Url.findAll();

      expect(urls).toHaveLength(2);
    });

    it('should include creator username', async () => {
      const user = await createTestUser({ username: 'creator' });
      createTestUrl({ slug: 'withcreator', creatorId: user.id });

      const urls = Url.findAll();

      expect(urls[0].creatorUsername).toBe('creator');
    });

    it('should support pagination', () => {
      for (let i = 0; i < 5; i++) {
        createTestUrl({ slug: `allpage${i}` });
      }

      const urls = Url.findAll(3, 0);

      expect(urls).toHaveLength(3);
    });
  });

  describe('countAll', () => {
    it('should return total URL count', () => {
      createTestUrl({ slug: 'cnt1' });
      createTestUrl({ slug: 'cnt2' });

      const count = Url.countAll();
      expect(count).toBe(2);
    });
  });

  describe('incrementClicks', () => {
    it('should increment click counter atomically', () => {
      const url = createTestUrl({ slug: 'click', clicks: 5 });

      const newCount = Url.incrementClicks('click');

      expect(newCount).toBe(6);

      const updated = Url.findById(url.id);
      expect(updated.clicks).toBe(6);
    });

    it('should return 0 for non-existent slug', () => {
      const count = Url.incrementClicks('nonexistent');
      expect(count).toBe(0);
    });
  });

  describe('update', () => {
    it('should update URL fields', () => {
      const url = createTestUrl({
        slug: 'update',
        longUrl: 'https://old.com'
      });

      const updated = Url.update(url.id, {
        longUrl: 'https://new.com',
        maxUses: 50
      });

      expect(updated.longUrl).toBe('https://new.com');
      expect(updated.maxUses).toBe(50);
    });

    it('should remove password when set to empty string', () => {
      const url = createTestUrl({
        slug: 'pwremove',
        password: 'hashedpw'
      });

      const updated = Url.update(url.id, {
        longUrl: url.longUrl,
        password: ''
      });

      expect(updated.password).toBeNull();
    });

    it('should keep existing password when undefined', () => {
      const url = createTestUrl({
        slug: 'pwkeep',
        password: 'keepme'
      });

      const updated = Url.update(url.id, {
        longUrl: 'https://updated.com'
        // password not specified
      });

      expect(updated.password).toBe('keepme');
    });
  });

  describe('delete', () => {
    it('should delete existing URL', () => {
      const url = createTestUrl({ slug: 'todelete' });

      const result = Url.delete(url.id);

      expect(result).toBe(true);
      expect(Url.findById(url.id)).toBeUndefined();
    });

    it('should return false for non-existent URL', () => {
      const result = Url.delete(99999);
      expect(result).toBe(false);
    });
  });

  describe('block/unblock', () => {
    it('should block a URL', () => {
      const url = createTestUrl({ slug: 'toblock' });

      const result = Url.block(url.id);

      expect(result).toBe(true);
      const updated = Url.findById(url.id);
      expect(updated.isBlocked).toBe(1);
    });

    it('should unblock a URL', () => {
      const url = createTestUrl({ slug: 'tounblock', isBlocked: 1 });

      const result = Url.unblock(url.id);

      expect(result).toBe(true);
      const updated = Url.findById(url.id);
      expect(updated.isBlocked).toBe(0);
    });
  });

  describe('deleteInactiveAnonymous', () => {
    const DAY_MS = 24 * 60 * 60 * 1000;

    it('should delete anonymous URLs with expired expiresAt', () => {
      const past = new Date(Date.now() - DAY_MS).toISOString();
      createTestUrl({ slug: 'ia-anon-exp', creatorId: null, expiresAt: past });

      expect(Url.deleteInactiveAnonymous()).toBe(1);
      expect(Url.findBySlug('ia-anon-exp')).toBeUndefined();
    });

    it('should delete anonymous URLs with past deactivateAt', () => {
      const past = new Date(Date.now() - DAY_MS).toISOString();
      createTestUrl({ slug: 'ia-anon-deact', creatorId: null, deactivateAt: past });

      expect(Url.deleteInactiveAnonymous()).toBe(1);
      expect(Url.findBySlug('ia-anon-deact')).toBeUndefined();
    });

    it('should delete anonymous URLs where either condition is met', () => {
      const past = new Date(Date.now() - DAY_MS).toISOString();
      const future = new Date(Date.now() + DAY_MS).toISOString();
      createTestUrl({ slug: 'ia-anon-both', creatorId: null, expiresAt: past, deactivateAt: future });

      expect(Url.deleteInactiveAnonymous()).toBe(1);
    });

    it('should not delete anonymous URLs that are still active', () => {
      const future = new Date(Date.now() + DAY_MS).toISOString();
      createTestUrl({ slug: 'ia-anon-ok', creatorId: null, expiresAt: future });

      expect(Url.deleteInactiveAnonymous()).toBe(0);
      expect(Url.findBySlug('ia-anon-ok')).toBeDefined();
    });

    it('should not delete anonymous URLs with no inactive date', () => {
      createTestUrl({ slug: 'ia-anon-none', creatorId: null });

      expect(Url.deleteInactiveAnonymous()).toBe(0);
      expect(Url.findBySlug('ia-anon-none')).toBeDefined();
    });

    it('should not delete registered-user URLs', async () => {
      const user = await createTestUser();
      const past = new Date(Date.now() - DAY_MS).toISOString();
      createTestUrl({ slug: 'ia-reg-skip', creatorId: user.id, expiresAt: past });

      expect(Url.deleteInactiveAnonymous()).toBe(0);
      expect(Url.findBySlug('ia-reg-skip')).toBeDefined();
    });
  });

  describe('deleteInactiveRegistered', () => {
    const DAY_MS = 24 * 60 * 60 * 1000;

    it('should delete registered URLs with expiresAt beyond the grace period', async () => {
      const user = await createTestUser();
      const past = new Date(Date.now() - 91 * DAY_MS).toISOString();
      createTestUrl({ slug: 'ir-exp-old', creatorId: user.id, expiresAt: past });

      expect(Url.deleteInactiveRegistered(90)).toBe(1);
      expect(Url.findBySlug('ir-exp-old')).toBeUndefined();
    });

    it('should delete registered URLs with deactivateAt beyond the grace period', async () => {
      const user = await createTestUser();
      const past = new Date(Date.now() - 91 * DAY_MS).toISOString();
      createTestUrl({ slug: 'ir-deact-old', creatorId: user.id, deactivateAt: past });

      expect(Url.deleteInactiveRegistered(90)).toBe(1);
      expect(Url.findBySlug('ir-deact-old')).toBeUndefined();
    });

    it('should not delete registered URLs still within the grace period', async () => {
      const user = await createTestUser();
      const past = new Date(Date.now() - 30 * DAY_MS).toISOString();
      createTestUrl({ slug: 'ir-grace-recent', creatorId: user.id, expiresAt: past });

      expect(Url.deleteInactiveRegistered(90)).toBe(0);
      expect(Url.findBySlug('ir-grace-recent')).toBeDefined();
    });

    it('should not delete at the exact grace period boundary', async () => {
      const user = await createTestUser();
      // Use 89 days to avoid sub-millisecond timing edge at exactly 90 days
      const past = new Date(Date.now() - 89 * DAY_MS).toISOString();
      createTestUrl({ slug: 'ir-boundary', creatorId: user.id, expiresAt: past });

      expect(Url.deleteInactiveRegistered(90)).toBe(0);
      expect(Url.findBySlug('ir-boundary')).toBeDefined();
    });

    it('should never delete anonymous URLs', () => {
      const past = new Date(Date.now() - 200 * DAY_MS).toISOString();
      createTestUrl({ slug: 'ir-anon', creatorId: null, expiresAt: past });

      expect(Url.deleteInactiveRegistered(90)).toBe(0);
      expect(Url.findBySlug('ir-anon')).toBeDefined();
    });

    it('should not delete URLs with no inactive dates', async () => {
      const user = await createTestUser();
      createTestUrl({ slug: 'ir-none', creatorId: user.id });

      expect(Url.deleteInactiveRegistered(90)).toBe(0);
      expect(Url.findBySlug('ir-none')).toBeDefined();
    });

    it('should respect a custom grace period', async () => {
      const user = await createTestUser();
      const past = new Date(Date.now() - 10 * DAY_MS).toISOString();
      createTestUrl({ slug: 'ir-custom', creatorId: user.id, expiresAt: past });

      expect(Url.deleteInactiveRegistered(30)).toBe(0);
      expect(Url.findBySlug('ir-custom')).toBeDefined();

      expect(Url.deleteInactiveRegistered(7)).toBe(1);
      expect(Url.findBySlug('ir-custom')).toBeUndefined();
    });

    it('should delete when either expiresAt or deactivateAt triggers the grace period', async () => {
      const user = await createTestUser();
      const old = new Date(Date.now() - 100 * DAY_MS).toISOString();
      const recent = new Date(Date.now() - 10 * DAY_MS).toISOString();
      const future = new Date(Date.now() + DAY_MS).toISOString();

      createTestUrl({ slug: 'ir-del-exp', creatorId: user.id, expiresAt: old });
      createTestUrl({ slug: 'ir-del-deact', creatorId: user.id, deactivateAt: old });
      createTestUrl({ slug: 'ir-keep1', creatorId: user.id, expiresAt: recent });
      createTestUrl({ slug: 'ir-keep2', creatorId: user.id, deactivateAt: future });
      createTestUrl({ slug: 'ir-keep3', creatorId: null, expiresAt: old }); // anonymous

      const deleted = Url.deleteInactiveRegistered(90);

      expect(deleted).toBe(2);
      expect(Url.findBySlug('ir-del-exp')).toBeUndefined();
      expect(Url.findBySlug('ir-del-deact')).toBeUndefined();
      expect(Url.findBySlug('ir-keep1')).toBeDefined();
      expect(Url.findBySlug('ir-keep2')).toBeDefined();
      expect(Url.findBySlug('ir-keep3')).toBeDefined();
    });
  });

});
