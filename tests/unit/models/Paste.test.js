const Paste = require('../../../models/Paste');
const { createTestUser, createTestPaste } = require('../../setup/testHelpers');

// Helpers
const future = (ms = 86400000) => new Date(Date.now() + ms).toISOString();
const past   = (ms = 86400000) => new Date(Date.now() - ms).toISOString();

describe('Paste Model', () => {

  // ─── create ────────────────────────────────────────────────
  describe('create', () => {
    it('creates a paste with required fields', () => {
      const paste = Paste.create({ slug: 'abc12', content: 'hello\nworld' });

      expect(paste).toBeDefined();
      expect(paste.id).toBeDefined();
      expect(paste.slug).toBe('abc12');
      expect(paste.content).toBe('hello\nworld');
      expect(paste.userId).toBeNull();
      expect(paste.views).toBe(0);
      expect(paste.isBlocked).toBe(0);
      expect(paste.tags).toEqual([]);
    });

    it('creates a paste with all optional fields', async () => {
      const user = await createTestUser();
      const expiresAt = future();
      const activateAt = past(3600000);
      const deactivateAt = future(172800000);

      const paste = Paste.create({
        userId: user.id,
        slug: 'full1',
        title: 'Config',
        content: 'a = 1',
        language: 'toml',
        expiresAt,
        activateAt,
        deactivateAt,
        maxViews: 5,
        password: '$2b$10$hashedpassword'
      });

      expect(paste.userId).toBe(user.id);
      expect(paste.title).toBe('Config');
      expect(paste.language).toBe('toml');
      expect(paste.expiresAt).toBe(expiresAt);
      expect(paste.activateAt).toBe(activateAt);
      expect(paste.deactivateAt).toBe(deactivateAt);
      expect(paste.maxViews).toBe(5);
      expect(paste.password).toBe('$2b$10$hashedpassword');
    });
  });

  // ─── findById / findBySlug ─────────────────────────────────
  describe('findById / findBySlug', () => {
    it('finds a paste by id with tags attached', () => {
      const created = createTestPaste(null, { slug: 'find1' });
      const found = Paste.findById(created.id);
      expect(found.slug).toBe('find1');
      expect(Array.isArray(found.tags)).toBe(true);
    });

    it('finds a paste by slug', () => {
      createTestPaste(null, { slug: 'find2' });
      const found = Paste.findBySlug('find2');
      expect(found).toBeDefined();
      expect(found.slug).toBe('find2');
    });

    it('returns undefined for a missing paste', () => {
      expect(Paste.findById(99999)).toBeUndefined();
      expect(Paste.findBySlug('nope99')).toBeUndefined();
    });
  });

  // ─── findByUserId / countByUserId ──────────────────────────
  describe('findByUserId / countByUserId', () => {
    it('returns only the user\'s pastes, newest first', async () => {
      const user = await createTestUser();
      const other = await createTestUser({ username: 'other' });
      createTestPaste(user.id, { slug: 'u1' });
      createTestPaste(user.id, { slug: 'u2' });
      createTestPaste(other.id, { slug: 'o1' });

      const list = Paste.findByUserId(user.id);
      expect(list).toHaveLength(2);
      expect(list.every(p => p.userId === user.id)).toBe(true);
      expect(Paste.countByUserId(user.id)).toBe(2);
    });

    it('supports limit and offset', async () => {
      const user = await createTestUser();
      for (let i = 0; i < 5; i++) createTestPaste(user.id, { slug: `p${i}` });
      expect(Paste.findByUserId(user.id, 2, 0)).toHaveLength(2);
      expect(Paste.findByUserId(user.id, 2, 4)).toHaveLength(1);
    });
  });


  // ─── findExpired ───────────────────────────────────────────
  describe('findExpired', () => {
    it('finds pastes past expiresAt or deactivateAt', () => {
      createTestPaste(null, { slug: 'e1', expiresAt: past() });
      createTestPaste(null, { slug: 'e2', deactivateAt: past() });
      createTestPaste(null, { slug: 'e3', expiresAt: future() });

      const expired = Paste.findExpired().map(p => p.slug).sort();
      expect(expired).toEqual(['e1', 'e2']);
    });
  });

  // ─── delete ────────────────────────────────────────────────
  describe('delete', () => {
    it('deletes a paste', () => {
      const p = createTestPaste(null, { slug: 'del1' });
      Paste.delete(p.id);
      expect(Paste.findById(p.id)).toBeUndefined();
    });
  });

  // ─── incrementViews ────────────────────────────────────────
  describe('incrementViews', () => {
    it('atomically increments the view counter', () => {
      const p = createTestPaste(null, { slug: 'v1' });
      Paste.incrementViews(p.id);
      Paste.incrementViews(p.id);
      expect(Paste.findById(p.id).views).toBe(2);
    });
  });

  // ─── update ────────────────────────────────────────────────
  describe('update', () => {
    it('updates provided fields and coalesces undefined ones', () => {
      const p = createTestPaste(null, { slug: 'up1', title: 'Old', content: 'old body', language: 'js' });
      const updated = Paste.update(p.id, { title: 'New', content: 'new body' });
      expect(updated.title).toBe('New');
      expect(updated.content).toBe('new body');
      expect(updated.language).toBe('js'); // untouched
    });

    it('password: undefined keeps, null clears, string sets', () => {
      const p = createTestPaste(null, { slug: 'up2', password: 'hash1' });
      Paste.update(p.id, { title: 'x' });
      expect(Paste.findById(p.id).password).toBe('hash1');
      Paste.update(p.id, { password: 'hash2' });
      expect(Paste.findById(p.id).password).toBe('hash2');
      Paste.update(p.id, { password: null });
      expect(Paste.findById(p.id).password).toBeNull();
    });

  });

  // ─── block / unblock ───────────────────────────────────────
  describe('block / unblock', () => {
    it('toggles the isBlocked flag', () => {
      const p = createTestPaste(null, { slug: 'b1' });
      expect(Paste.block(p.id)).toBe(true);
      expect(Paste.findById(p.id).isBlocked).toBe(1);
      expect(Paste.unblock(p.id)).toBe(true);
      expect(Paste.findById(p.id).isBlocked).toBe(0);
    });
  });

  // ─── deleteInactiveAnonymous / deleteInactiveRegistered ────
  describe('cleanup', () => {
    it('deleteInactiveAnonymous removes only expired anonymous pastes', async () => {
      const user = await createTestUser();
      createTestPaste(null, { slug: 'c1', expiresAt: past() });        // anon, expired -> deleted
      createTestPaste(null, { slug: 'c2', expiresAt: future() });       // anon, active  -> kept
      createTestPaste(user.id, { slug: 'c3', expiresAt: past() });      // registered, expired -> kept here

      const deleted = Paste.deleteInactiveAnonymous();
      expect(deleted).toBe(1);
      expect(Paste.findBySlug('c1')).toBeUndefined();
      expect(Paste.findBySlug('c2')).toBeDefined();
      expect(Paste.findBySlug('c3')).toBeDefined();
    });

    it('deleteInactiveRegistered respects the grace period', async () => {
      const user = await createTestUser();
      createTestPaste(user.id, { slug: 'g1', expiresAt: past(100 * 86400000) }); // 100 days ago
      createTestPaste(user.id, { slug: 'g2', expiresAt: past(10 * 86400000) });  // 10 days ago

      const deleted = Paste.deleteInactiveRegistered(90);
      expect(deleted).toBe(1);
      expect(Paste.findBySlug('g1')).toBeUndefined();
      expect(Paste.findBySlug('g2')).toBeDefined();
    });
  });
});
