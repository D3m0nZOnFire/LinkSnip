const crypto = require('crypto');
const db = require('../config/database');

/**
 * Analytics share links: read-only, revocable /stats/<token> links for one URL.
 *
 * The token (32 random bytes, base64url) is returned once by create() and never
 * stored; the table keeps its SHA-256 hash. An expired link behaves as if it
 * doesn't exist, and revoking deletes it.
 */

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const now = () => new Date().toISOString();

// Every column except the hash, which never leaves this model.
const PUBLIC_COLUMNS = 's.id, s.urlId, s.createdBy, s.label, s.expiresAt, s.viewCount, s.lastViewedAt, s.createdAt';
const ACTIVE = '(s.expiresAt IS NULL OR s.expiresAt > ?)';

class AnalyticsShare {
  /**
   * @param {{ urlId: number, createdBy: number, label?: string, expiresAt?: string }} data
   * @returns {{ token: string, link: object }} token is only available here
   */
  static create({ urlId, createdBy, label = null, expiresAt = null }) {
    const token = crypto.randomBytes(32).toString('base64url');
    const result = db.prepare(`
      INSERT INTO analytics_shares (urlId, createdBy, tokenHash, label, expiresAt)
      VALUES (?, ?, ?, ?, ?)
    `).run(urlId, createdBy, hashToken(token), label, expiresAt);

    return { token, link: this.findById(result.lastInsertRowid) };
  }

  static findById(id) {
    return db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM analytics_shares s WHERE s.id = ?`).get(id) || null;
  }

  /** The active link for a token, or null (unknown, revoked or expired). */
  static findByToken(token) {
    if (!token) return null;
    return db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM analytics_shares s WHERE s.tokenHash = ? AND ${ACTIVE}`)
      .get(hashToken(token), now()) || null;
  }

  static findActiveByUrlId(urlId) {
    return db.prepare(`
      SELECT ${PUBLIC_COLUMNS} FROM analytics_shares s
      WHERE s.urlId = ? AND ${ACTIVE}
      ORDER BY s.createdAt DESC, s.id DESC
    `).all(urlId, now());
  }

  static countActiveByUrlId(urlId) {
    return db.prepare(`SELECT COUNT(*) AS n FROM analytics_shares s WHERE s.urlId = ? AND ${ACTIVE}`).get(urlId, now()).n;
  }

  /** Active links across all URLs, with slug and creator, for Admin → Analytics Shares. */
  static findAll({ limit = 50, offset = 0 } = {}) {
    return db.prepare(`
      SELECT ${PUBLIC_COLUMNS}, u.slug, u.longUrl, c.username AS createdByUsername
      FROM analytics_shares s
      JOIN urls u ON u.id = s.urlId
      LEFT JOIN users c ON c.id = s.createdBy
      WHERE ${ACTIVE}
      ORDER BY s.createdAt DESC, s.id DESC
      LIMIT ? OFFSET ?
    `).all(now(), limit, offset);
  }

  static countAll() {
    return db.prepare(`SELECT COUNT(*) AS n FROM analytics_shares s WHERE ${ACTIVE}`).get(now()).n;
  }

  static recordView(id) {
    db.prepare('UPDATE analytics_shares SET viewCount = viewCount + 1, lastViewedAt = ? WHERE id = ?').run(now(), id);
  }

  /** @returns {boolean} Whether a link was deleted */
  static revoke(id) {
    return db.prepare('DELETE FROM analytics_shares WHERE id = ?').run(id).changes > 0;
  }

  /** @returns {number} Number of expired links deleted */
  static deleteExpired() {
    return db.prepare('DELETE FROM analytics_shares WHERE expiresAt IS NOT NULL AND expiresAt <= ?').run(now()).changes;
  }
}

module.exports = AnalyticsShare;
