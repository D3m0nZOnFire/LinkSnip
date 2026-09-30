const crypto = require('crypto');
const db = require('../config/database');
const { CONTENT_TYPES, contentType } = require('../services/contentTypes');

/**
 * Analytics share links: read-only, revocable /stats/<token> links for one item of any
 * content type (targetType + targetId).
 *
 * The token (32 random bytes, base64url) is returned once by create() and never
 * stored; the table keeps its SHA-256 hash. An expired link behaves as if it
 * doesn't exist, and revoking deletes it.
 */

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const now = () => new Date().toISOString();

// Every column except the hash, which never leaves this model.
const PUBLIC_COLUMNS = 's.id, s.targetType, s.targetId, s.createdBy, s.label, s.expiresAt, s.viewCount, s.lastViewedAt, s.createdAt';
const ACTIVE = '(s.expiresAt IS NULL OR s.expiresAt > ?)';

class AnalyticsShare {
  /**
   * @param {{ targetType: string, targetId: number, createdBy: number, label?: string, expiresAt?: string }} data
   * @returns {{ token: string, link: object }} token is only available here
   */
  static create({ targetType, targetId, createdBy, label = null, expiresAt = null }) {
    const token = crypto.randomBytes(32).toString('base64url');
    const result = db.prepare(`
      INSERT INTO analytics_shares (targetType, targetId, createdBy, tokenHash, label, expiresAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(targetType, targetId, createdBy, hashToken(token), label, expiresAt);

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

  static findActive(targetType, targetId) {
    return db.prepare(`
      SELECT ${PUBLIC_COLUMNS} FROM analytics_shares s
      WHERE s.targetType = ? AND s.targetId = ? AND ${ACTIVE}
      ORDER BY s.createdAt DESC, s.id DESC
    `).all(targetType, targetId, now());
  }

  static countActive(targetType, targetId) {
    return db.prepare(`SELECT COUNT(*) AS n FROM analytics_shares s WHERE s.targetType = ? AND s.targetId = ? AND ${ACTIVE}`)
      .get(targetType, targetId, now()).n;
  }

  /**
   * Active links of every type, with the item's slug, public path and target (its link,
   * title or file name) and the creator, for Admin → Analytics Shares.
   */
  static findAll({ limit = 50, offset = 0 } = {}) {
    const branches = Object.entries(CONTENT_TYPES).map(([type, info]) => `
      SELECT ${PUBLIC_COLUMNS}, item.slug, item.${info.destination} AS target, c.username AS createdByUsername
      FROM analytics_shares s
      JOIN ${info.table} item ON s.targetType = '${type}' AND item.id = s.targetId
      LEFT JOIN users c ON c.id = s.createdBy
      WHERE ${ACTIVE}`);
    const rows = db.prepare(`
      SELECT * FROM (${branches.join(' UNION ALL ')}) ORDER BY createdAt DESC, id DESC LIMIT ? OFFSET ?
    `).all(...branches.map(() => now()), limit, offset);
    return rows.map(row => ({ ...row, path: `${contentType(row.targetType).publicPrefix}${row.slug}` }));
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
