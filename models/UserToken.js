const crypto = require('crypto');
const db = require('../config/database');

/**
 * One-time tokens for links sent by mail: `verify_email` (confirms `email` for the user) and `reset_password`.
 *
 * The token (32 random bytes, base64url) is returned once by create() and never stored; the table keeps its
 * SHA-256 hash. A token works until it expires, is used (consume) or is cancelled (a newer token of the same
 * purpose, or cancel()). Used and cancelled rows stay a day, so countRecent() can cap how many mails one account
 * gets; deleteExpired() (nightly) removes them after that.
 */

const PURPOSES = ['verify_email', 'reset_password'];
const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const now = () => new Date().toISOString();
const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();

// Every column except the hash, which never leaves this model.
const PUBLIC_COLUMNS = 'id, userId, purpose, email, expiresAt, createdAt, usedAt';
const ACTIVE = 'usedAt IS NULL AND julianday(expiresAt) > julianday(?)';

function checkPurpose(purpose) {
  if (!PURPOSES.includes(purpose)) throw new Error(`Unknown token purpose: ${purpose}`);
}

class UserToken {
  /**
   * A new token; the user's earlier open tokens of the same purpose stop working.
   * @param {number} userId
   * @param {'verify_email'|'reset_password'} purpose
   * @param {{ email?: string|null, ttlMinutes: number }} options
   * @returns {string} The token (only available here)
   */
  static create(userId, purpose, { email = null, ttlMinutes }) {
    checkPurpose(purpose);
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + ttlMinutes * 60000).toISOString();
    db.transaction(() => {
      this.cancel(userId, purpose);
      db.prepare(`
        INSERT INTO user_tokens (userId, purpose, tokenHash, email, expiresAt, createdAt) VALUES (?, ?, ?, ?, ?, ?)
      `).run(userId, purpose, hashToken(token), email, expiresAt, now());
    })();
    return token;
  }

  /** The open token, or null (unknown, another purpose, used, cancelled or expired). Doesn't use it up. */
  static find(purpose, token) {
    if (!token) return null;
    return db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM user_tokens WHERE tokenHash = ? AND purpose = ? AND ${ACTIVE}`)
      .get(hashToken(token), purpose, now()) || null;
  }

  /**
   * Uses the token up, in one statement, so two requests with the same token can't both succeed.
   * @returns {object|null} The token's row, or null when it isn't open
   */
  static consume(purpose, token) {
    if (!token) return null;
    const at = now();
    return db.prepare(`
      UPDATE user_tokens SET usedAt = ? WHERE tokenHash = ? AND purpose = ? AND ${ACTIVE} RETURNING ${PUBLIC_COLUMNS}
    `).get(at, hashToken(token), purpose, at) || null;
  }

  /** Ends the user's open tokens of one purpose (a new address, a changed password). */
  static cancel(userId, purpose) {
    checkPurpose(purpose);
    db.prepare('UPDATE user_tokens SET usedAt = ? WHERE userId = ? AND purpose = ? AND usedAt IS NULL')
      .run(now(), userId, purpose);
  }

  /** How many tokens (= mails) of one purpose the user got in the last `minutes`, used or not. */
  static countRecent(userId, purpose, minutes) {
    return db.prepare(`
      SELECT COUNT(*) AS n FROM user_tokens WHERE userId = ? AND purpose = ? AND julianday(createdAt) > julianday(?)
    `).get(userId, purpose, minutesAgo(minutes)).n;
  }

  /** Removes tokens that expired or were used more than a day ago. @returns {number} How many */
  static deleteExpired() {
    const dayAgo = minutesAgo(24 * 60);
    return db.prepare(`
      DELETE FROM user_tokens
      WHERE julianday(expiresAt) < julianday(?) OR (usedAt IS NOT NULL AND julianday(usedAt) < julianday(?))
    `).run(dayAgo, dayAgo).changes;
  }
}

UserToken.PURPOSES = PURPOSES;

module.exports = UserToken;
