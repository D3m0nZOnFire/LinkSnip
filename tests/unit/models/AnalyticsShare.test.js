const crypto = require('crypto');
const AnalyticsShare = require('../../../models/AnalyticsShare');
const { getTestDatabase } = require('../../setup/testDatabase');
const { createTestUser, createTestUrl } = require('../../setup/testHelpers');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const PAST = '2000-01-01T00:00:00.000Z';
const FUTURE = '2999-01-01T00:00:00.000Z';

let owner;
let url;
beforeEach(async () => {
  owner = await createTestUser({ username: 'owner' });
  url = createTestUrl({ slug: 'abc', creatorId: owner.id });
});

describe('AnalyticsShare (share links)', () => {
  describe('create', () => {
    it('returns a long random token once', () => {
      const { token, link } = AnalyticsShare.create({ urlId: url.id, createdBy: owner.id });

      expect(token).toMatch(/^[A-Za-z0-9_-]{43,}$/); // 32+ random bytes, base64url
      expect(link.id).toEqual(expect.any(Number));
      expect(link).not.toHaveProperty('token');
      expect(link).not.toHaveProperty('tokenHash');
    });

    it('stores only the SHA-256 hash of the token', () => {
      const { token } = AnalyticsShare.create({ urlId: url.id, createdBy: owner.id });
      const row = getTestDatabase().prepare('SELECT * FROM analytics_shares').get();

      expect(row.tokenHash).toBe(sha256(token));
      expect(Object.values(row)).not.toContain(token);
    });

    it('gives every link a different token', () => {
      const a = AnalyticsShare.create({ urlId: url.id, createdBy: owner.id }).token;
      const b = AnalyticsShare.create({ urlId: url.id, createdBy: owner.id }).token;
      expect(a).not.toBe(b);
    });

    it('keeps an optional label and expiry', () => {
      const { link } = AnalyticsShare.create({ urlId: url.id, createdBy: owner.id, label: 'Client', expiresAt: FUTURE });
      expect(link).toEqual(expect.objectContaining({ label: 'Client', expiresAt: FUTURE, viewCount: 0 }));
    });
  });

  describe('findByToken', () => {
    it('finds an active link by its token', () => {
      const { token, link } = AnalyticsShare.create({ urlId: url.id, createdBy: owner.id });
      expect(AnalyticsShare.findByToken(token).id).toBe(link.id);
    });

    it('returns null for an unknown, empty or revoked token', () => {
      const { token, link } = AnalyticsShare.create({ urlId: url.id, createdBy: owner.id });

      expect(AnalyticsShare.findByToken('nope')).toBeNull();
      expect(AnalyticsShare.findByToken('')).toBeNull();
      expect(AnalyticsShare.findByToken(undefined)).toBeNull();

      AnalyticsShare.revoke(link.id);
      expect(AnalyticsShare.findByToken(token)).toBeNull();
    });

    it('returns null once the link has expired', () => {
      const { token } = AnalyticsShare.create({ urlId: url.id, createdBy: owner.id, expiresAt: PAST });
      expect(AnalyticsShare.findByToken(token)).toBeNull();
    });
  });

  describe('listing and counting', () => {
    it('lists and counts only active links for a URL', () => {
      AnalyticsShare.create({ urlId: url.id, createdBy: owner.id });
      AnalyticsShare.create({ urlId: url.id, createdBy: owner.id, expiresAt: FUTURE });
      AnalyticsShare.create({ urlId: url.id, createdBy: owner.id, expiresAt: PAST });

      expect(AnalyticsShare.countActiveByUrlId(url.id)).toBe(2);
      expect(AnalyticsShare.findActiveByUrlId(url.id)).toHaveLength(2);
      expect(AnalyticsShare.findActiveByUrlId(url.id)[0]).not.toHaveProperty('tokenHash');
    });

    it('lists every active link for admins, with the URL slug and creator', () => {
      AnalyticsShare.create({ urlId: url.id, createdBy: owner.id, label: 'A' });

      const [row] = AnalyticsShare.findAll({ limit: 10, offset: 0 });

      expect(row).toEqual(expect.objectContaining({ label: 'A', slug: 'abc', createdByUsername: 'owner' }));
      expect(row).not.toHaveProperty('tokenHash');
      expect(AnalyticsShare.countAll()).toBe(1);
    });
  });

  describe('views and cleanup', () => {
    it('counts views', () => {
      const { link } = AnalyticsShare.create({ urlId: url.id, createdBy: owner.id });

      AnalyticsShare.recordView(link.id);
      AnalyticsShare.recordView(link.id);

      const updated = AnalyticsShare.findById(link.id);
      expect(updated.viewCount).toBe(2);
      expect(updated.lastViewedAt).toEqual(expect.any(String));
    });

    it('deleteExpired removes only expired links', () => {
      AnalyticsShare.create({ urlId: url.id, createdBy: owner.id, expiresAt: PAST });
      AnalyticsShare.create({ urlId: url.id, createdBy: owner.id });

      expect(AnalyticsShare.deleteExpired()).toBe(1);
      expect(AnalyticsShare.countAll()).toBe(1);
    });

    it('is deleted with its URL', () => {
      AnalyticsShare.create({ urlId: url.id, createdBy: owner.id });
      getTestDatabase().prepare('DELETE FROM urls WHERE id = ?').run(url.id);
      expect(AnalyticsShare.countAll()).toBe(0);
    });
  });
});
