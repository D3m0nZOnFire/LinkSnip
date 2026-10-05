const File = require('../../../models/File');
const { createTestUser, createTestTag, createTestFile, tagItem } = require('../../setup/testHelpers');

// Helpers
const future = (ms = 86400000) => new Date(Date.now() + ms).toISOString();
const past   = (ms = 86400000) => new Date(Date.now() - ms).toISOString();

describe('File Model', () => {

  // ─── create ────────────────────────────────────────────────
  describe('create', () => {
    it('creates a file with required fields', async () => {
      const user = await createTestUser();
      const file = File.create({
        userId: user.id,
        slug: 'abc12',
        originalName: 'doc.pdf',
        storedName: 'uuid.pdf',
        mimeType: 'application/pdf',
        size: 2048
      });

      expect(file).toBeDefined();
      expect(file.id).toBeDefined();
      expect(file.slug).toBe('abc12');
      expect(file.originalName).toBe('doc.pdf');
      expect(file.mimeType).toBe('application/pdf');
      expect(file.size).toBe(2048);
      expect(file.downloads).toBe(0);
      expect(file.sharingMode).toBe('public');
      expect(file.isBlocked).toBe(0);
    });

    it('creates a file with all optional fields', async () => {
      const user = await createTestUser();
      const expiresAt   = future();
      const activateAt  = past(3600000);
      const deactivateAt = future(172800000);

      const file = File.create({
        userId: user.id,
        slug: 'full1',
        originalName: 'img.png',
        storedName: 'uuid.png',
        mimeType: 'image/png',
        size: 512,
        expiresAt,
        activateAt,
        deactivateAt,
        maxDownloads: 5,
        password: '$2b$10$hashedpassword',
        sharingMode: 'restricted',
        allowedUsers: [99, 100]
      });

      expect(file.expiresAt).toBe(expiresAt);
      expect(file.activateAt).toBe(activateAt);
      expect(file.deactivateAt).toBe(deactivateAt);
      expect(file.maxDownloads).toBe(5);
      expect(file.password).toBe('$2b$10$hashedpassword');
      expect(file.sharingMode).toBe('restricted');
      expect(JSON.parse(file.allowedUsers)).toEqual([99, 100]);
    });

    it('defaults sharingMode to public and allowedUsers to []', async () => {
      const user = await createTestUser();
      const file = File.create({
        userId: user.id, slug: 'def01', originalName: 'x.txt',
        storedName: 'u.txt', mimeType: 'text/plain', size: 10
      });

      expect(file.sharingMode).toBe('public');
      expect(JSON.parse(file.allowedUsers)).toEqual([]);
    });
  });

  // ─── findBySlug ────────────────────────────────────────────
  describe('findBySlug', () => {
    it('returns the file for an existing slug', async () => {
      const user = await createTestUser();
      createTestFile(user.id, { slug: 'findme' });

      const file = File.findBySlug('findme');
      expect(file).toBeDefined();
      expect(file.slug).toBe('findme');
    });

    it('returns undefined for a non-existent slug', () => {
      expect(File.findBySlug('nope99')).toBeUndefined();
    });

    it('includes tags array on the returned file', async () => {
      const user = await createTestUser();
      const tag  = createTestTag({ name: 'docs', userId: user.id });
      const f    = createTestFile(user.id, { slug: 'tagged1' });
      tagItem('file', f.id, tag.id);

      const file = File.findBySlug('tagged1');
      expect(file.tags).toHaveLength(1);
      expect(file.tags[0].name).toBe('docs');
    });
  });

  // ─── findByUserId ──────────────────────────────────────────
  describe('findByUserId', () => {
    it('returns all files for a user', async () => {
      const user = await createTestUser();
      createTestFile(user.id, { slug: 'f001' });
      createTestFile(user.id, { slug: 'f002' });

      const files = File.findByUserId(user.id);
      expect(files).toHaveLength(2);
    });

    it('returns empty array for a user with no files', async () => {
      const user = await createTestUser();
      expect(File.findByUserId(user.id)).toEqual([]);
    });

    it('does not return files belonging to other users', async () => {
      const userA = await createTestUser();
      const userB = await createTestUser();
      createTestFile(userA.id, { slug: 'fa01' });

      expect(File.findByUserId(userB.id)).toHaveLength(0);
    });

    it('respects limit and offset', async () => {
      const user = await createTestUser();
      createTestFile(user.id, { slug: 'p001' });
      createTestFile(user.id, { slug: 'p002' });
      createTestFile(user.id, { slug: 'p003' });

      const page1 = File.findByUserId(user.id, 2, 0);
      const page2 = File.findByUserId(user.id, 2, 2);
      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(1);
    });
  });

  // ─── countByUserId ─────────────────────────────────────────
  describe('countByUserId', () => {
    it('returns the correct file count for a user', async () => {
      const user = await createTestUser();
      createTestFile(user.id, { slug: 'c001' });
      createTestFile(user.id, { slug: 'c002' });

      expect(File.countByUserId(user.id)).toBe(2);
    });

    it('returns 0 for a user with no files', async () => {
      const user = await createTestUser();
      expect(File.countByUserId(user.id)).toBe(0);
    });
  });



  // ─── findExpired ───────────────────────────────────────────
  describe('findExpired', () => {
    it('returns files whose expiresAt is in the past', async () => {
      const user = await createTestUser();
      createTestFile(user.id, { slug: 'exp1', expiresAt: past() });
      createTestFile(user.id, { slug: 'exp2', expiresAt: future() });

      const expired = File.findExpired();
      expect(expired.map(f => f.slug)).toContain('exp1');
      expect(expired.map(f => f.slug)).not.toContain('exp2');
    });

    it('returns files whose deactivateAt is in the past', async () => {
      const user = await createTestUser();
      createTestFile(user.id, { slug: 'dct1', deactivateAt: past() });
      createTestFile(user.id, { slug: 'dct2', deactivateAt: future() });

      const expired = File.findExpired();
      expect(expired.map(f => f.slug)).toContain('dct1');
      expect(expired.map(f => f.slug)).not.toContain('dct2');
    });

    it('does not return active files with no expiry', async () => {
      const user = await createTestUser();
      createTestFile(user.id, { slug: 'noexp' });

      expect(File.findExpired()).toHaveLength(0);
    });
  });

  // ─── delete ────────────────────────────────────────────────
  describe('delete', () => {
    it('removes the file from the database', async () => {
      const user = await createTestUser();
      const file = createTestFile(user.id, { slug: 'del01' });

      File.delete(file.id);
      expect(File.findBySlug('del01')).toBeUndefined();
    });

    it('returns change info with changes = 1', async () => {
      const user = await createTestUser();
      const file = createTestFile(user.id, { slug: 'del02' });

      const result = File.delete(file.id);
      expect(result.changes).toBe(1);
    });
  });

  // ─── incrementDownloads ────────────────────────────────────
  describe('incrementDownloads', () => {
    it('increments the download counter by 1', async () => {
      const user = await createTestUser();
      const file = createTestFile(user.id, { slug: 'dl001', downloads: 0 });

      File.incrementDownloads(file.id);
      const updated = File.findBySlug('dl001');
      expect(updated.downloads).toBe(1);
    });

    it('increments correctly from a non-zero value', async () => {
      const user = await createTestUser();
      const file = createTestFile(user.id, { slug: 'dl002', downloads: 4 });

      File.incrementDownloads(file.id);
      expect(File.findBySlug('dl002').downloads).toBe(5);
    });
  });

  // ─── update ────────────────────────────────────────────────
  describe('update', () => {
    it('updates expiry and maxDownloads', async () => {
      const user = await createTestUser();
      const file = createTestFile(user.id, { slug: 'upd01' });
      const newExpiry = future();

      const updated = File.update(file.id, { expiresAt: newExpiry, maxDownloads: 10 });
      expect(updated.expiresAt).toBe(newExpiry);
      expect(updated.maxDownloads).toBe(10);
    });

    it('preserves fields that are not passed', async () => {
      const user = await createTestUser();
      const file = createTestFile(user.id, { slug: 'upd02', maxDownloads: 5 });

      const updated = File.update(file.id, { sharingMode: 'restricted' });
      expect(updated.maxDownloads).toBe(5);
      expect(updated.sharingMode).toBe('restricted');
    });

    it('updates password', async () => {
      const user = await createTestUser();
      const file = createTestFile(user.id, { slug: 'upd03' });

      const updated = File.update(file.id, { password: '$2b$10$newhash' });
      expect(updated.password).toBe('$2b$10$newhash');
    });

    it('updates allowedUsers as JSON array', async () => {
      const user = await createTestUser();
      const file = createTestFile(user.id, { slug: 'upd04' });

      const updated = File.update(file.id, { allowedUsers: [1, 2, 3] });
      expect(JSON.parse(updated.allowedUsers)).toEqual([1, 2, 3]);
    });

    it('returns null for a non-existent file', async () => {
      expect(File.update(99999, { maxDownloads: 1 })).toBeNull();
    });
  });

});
