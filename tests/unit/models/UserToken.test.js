const crypto = require('crypto');
const UserToken = require('../../../models/UserToken');
const { getTestDatabase } = require('../../setup/testDatabase');
const { createTestUser } = require('../../setup/testHelpers');

// One-time tokens for email links (verify an address, reset a password). Only their SHA-256 hash is stored.

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const rows = () => getTestDatabase().prepare('SELECT * FROM user_tokens ORDER BY id').all();
const ago = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();

let user;
beforeEach(async () => { user = await createTestUser({ username: 'ann' }); });

describe('UserToken', () => {
  describe('create', () => {
    it('returns a long random token and stores only its hash', () => {
      const token = UserToken.create(user.id, 'reset_password', { ttlMinutes: 30 });
      expect(token).toMatch(/^[A-Za-z0-9_-]{43,}$/);
      const [row] = rows();
      expect(row.tokenHash).toBe(sha256(token));
      expect(JSON.stringify(row)).not.toContain(token);
    });

    it('expires after ttlMinutes', () => {
      UserToken.create(user.id, 'reset_password', { ttlMinutes: 30 });
      const minutes = (Date.parse(rows()[0].expiresAt) - Date.now()) / 60000;
      expect(minutes).toBeGreaterThan(29);
      expect(minutes).toBeLessThanOrEqual(30);
    });

    it('keeps the address it confirms', () => {
      const token = UserToken.create(user.id, 'verify_email', { email: 'new@example.com', ttlMinutes: 60 });
      expect(UserToken.find('verify_email', token).email).toBe('new@example.com');
    });

    it('cancels the earlier tokens of the same user and purpose, not others', async () => {
      const other = await createTestUser({ username: 'bob' });
      const first = UserToken.create(user.id, 'reset_password', { ttlMinutes: 30 });
      const verify = UserToken.create(user.id, 'verify_email', { email: 'a@example.com', ttlMinutes: 30 });
      const bobs = UserToken.create(other.id, 'reset_password', { ttlMinutes: 30 });
      const second = UserToken.create(user.id, 'reset_password', { ttlMinutes: 30 });

      expect(UserToken.find('reset_password', first)).toBeNull();
      expect(UserToken.find('reset_password', second)).not.toBeNull();
      expect(UserToken.find('verify_email', verify)).not.toBeNull();
      expect(UserToken.find('reset_password', bobs)).not.toBeNull();
    });
  });

  describe('find', () => {
    it('returns the active token without its hash', () => {
      const token = UserToken.create(user.id, 'reset_password', { ttlMinutes: 30 });
      const found = UserToken.find('reset_password', token);
      expect(found).toEqual(expect.objectContaining({ userId: user.id, purpose: 'reset_password' }));
      expect(found).not.toHaveProperty('tokenHash');
    });

    it.each([undefined, '', 'nope'])('returns null for an unknown token %p', (token) => {
      expect(UserToken.find('reset_password', token)).toBeNull();
    });

    it('returns null for another purpose', () => {
      const token = UserToken.create(user.id, 'verify_email', { email: 'a@example.com', ttlMinutes: 30 });
      expect(UserToken.find('reset_password', token)).toBeNull();
    });

    it('returns null once expired', () => {
      const token = UserToken.create(user.id, 'reset_password', { ttlMinutes: 30 });
      getTestDatabase().prepare('UPDATE user_tokens SET expiresAt = ?').run(ago(1));
      expect(UserToken.find('reset_password', token)).toBeNull();
    });
  });

  describe('consume', () => {
    it('works once', () => {
      const token = UserToken.create(user.id, 'reset_password', { ttlMinutes: 30 });
      expect(UserToken.consume('reset_password', token)).toEqual(expect.objectContaining({ userId: user.id }));
      expect(UserToken.consume('reset_password', token)).toBeNull();
      expect(UserToken.find('reset_password', token)).toBeNull();
    });

    it('refuses an expired token or another purpose', () => {
      const token = UserToken.create(user.id, 'reset_password', { ttlMinutes: 30 });
      expect(UserToken.consume('verify_email', token)).toBeNull();
      getTestDatabase().prepare('UPDATE user_tokens SET expiresAt = ?').run(ago(1));
      expect(UserToken.consume('reset_password', token)).toBeNull();
    });
  });

  describe('cancel', () => {
    it("ends a user's open tokens of one purpose", () => {
      const reset = UserToken.create(user.id, 'reset_password', { ttlMinutes: 30 });
      const verify = UserToken.create(user.id, 'verify_email', { email: 'a@example.com', ttlMinutes: 30 });
      UserToken.cancel(user.id, 'reset_password');
      expect(UserToken.find('reset_password', reset)).toBeNull();
      expect(UserToken.find('verify_email', verify)).not.toBeNull();
    });
  });

  describe('countRecent', () => {
    it('counts the tokens made in the last N minutes, cancelled and used ones too', () => {
      UserToken.create(user.id, 'reset_password', { ttlMinutes: 30 });
      UserToken.create(user.id, 'reset_password', { ttlMinutes: 30 });
      UserToken.create(user.id, 'verify_email', { email: 'a@example.com', ttlMinutes: 30 });
      getTestDatabase().prepare('UPDATE user_tokens SET createdAt = ? WHERE id = 1').run(ago(90));
      expect(UserToken.countRecent(user.id, 'reset_password', 60)).toBe(1);
      expect(UserToken.countRecent(user.id, 'reset_password', 120)).toBe(2);
    });
  });

  describe('deleteExpired', () => {
    it('removes tokens that ended more than a day ago and keeps the rest', () => {
      UserToken.create(user.id, 'reset_password', { ttlMinutes: 30 }); // live
      UserToken.create(user.id, 'verify_email', { email: 'a@example.com', ttlMinutes: 30 }); // will be old
      const db = getTestDatabase();
      db.prepare('UPDATE user_tokens SET createdAt = ?, expiresAt = ? WHERE id = 2').run(ago(3000), ago(2900));
      expect(UserToken.deleteExpired()).toBe(1);
      expect(rows().map(r => r.id)).toEqual([1]);
    });
  });
});
