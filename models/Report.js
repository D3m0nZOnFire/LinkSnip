const db = require('../config/database');
const { hashIp } = require('../services/ipHash');
const { CONTENT_TYPES, contentType } = require('../services/contentTypes');

/**
 * Reports on any content type (reports table: targetType + targetId).
 * One report per reporter per item (unique index); reporter IPs are stored as keyed hashes (services/ipHash.js).
 */
class Report {
  static REASONS = {
    FRAUD: 'Fraud/Scam',
    PHISHING: 'Phishing',
    MALWARE: 'Malware',
    SPAM: 'Spam',
    ADULT: 'Adult Content',
    COPYRIGHT: 'Copyright Violation',
    OTHER: 'Other'
  };

  static STATUSES = {
    PENDING: 'pending',
    REVIEWED: 'reviewed',
    DISMISSED: 'dismissed',
    BLOCKED: 'blocked'
  };

  static TYPES = Object.keys(CONTENT_TYPES);

  static create({ targetType, targetId, reporterIp, reason, description }) {
    const result = db.prepare(`
      INSERT INTO reports (targetType, targetId, reporterIpHash, reason, description)
      VALUES (?, ?, ?, ?, ?)
    `).run(targetType, targetId, hashIp(reporterIp), reason, description || null);
    return this.findById(result.lastInsertRowid);
  }

  static findById(id) {
    return db.prepare('SELECT * FROM reports WHERE id = ?').get(id);
  }

  static hasReported(targetType, targetId, reporterIp) {
    return !!db.prepare('SELECT id FROM reports WHERE targetType = ? AND targetId = ? AND reporterIpHash = ?')
      .get(targetType, targetId, hashIp(reporterIp));
  }

  /** Pending reports on one item (what counts toward quarantine). */
  static countPending(targetType, targetId) {
    return db.prepare("SELECT COUNT(*) AS n FROM reports WHERE targetType = ? AND targetId = ? AND status = 'pending'")
      .get(targetType, targetId).n;
  }

  /**
   * Reports with their item, owner and reviewer, newest first.
   * Each row gets slug, target (the item's link, title or file name), isBlocked,
   * isQuarantined, ownerId, creatorUsername, creatorIsBanned, reviewerUsername and path.
   * @param {object} options - { type (a content type, or null for all), status, limit, offset }
   */
  static findAll({ type = null, status = null, limit = 50, offset = 0 } = {}) {
    const types = type ? [type] : this.TYPES;
    const branches = types.map(t => {
      const info = contentType(t);
      return `
        SELECT r.*, item.slug, item.${info.destination} AS target, item.isBlocked, item.isQuarantined,
               item.${info.ownerColumn} AS ownerId, item.createdAt AS itemCreatedAt,
               creator.username AS creatorUsername, creator.isBanned AS creatorIsBanned,
               reviewer.username AS reviewerUsername
        FROM reports r
        JOIN ${info.table} item ON r.targetType = '${t}' AND r.targetId = item.id
        LEFT JOIN users creator ON item.${info.ownerColumn} = creator.id
        LEFT JOIN users reviewer ON r.reviewedBy = reviewer.id
        ${status ? 'WHERE r.status = ?' : ''}`;
    });

    let query = `SELECT * FROM (${branches.join(' UNION ALL ')}) ORDER BY createdAt DESC, id DESC`;
    const params = status ? types.map(() => status) : [];
    if (limit !== null) {
      query += ' LIMIT ? OFFSET ?';
      params.push(limit, offset);
    }

    return db.prepare(query).all(...params).map(row => ({
      ...row,
      path: `${contentType(row.targetType).publicPrefix}${row.slug}`
    }));
  }

  static count({ type = null, status = null } = {}) {
    const conditions = [];
    const params = [];
    if (type) { conditions.push('targetType = ?'); params.push(type); }
    if (status) { conditions.push('status = ?'); params.push(status); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    return db.prepare(`SELECT COUNT(*) AS n FROM reports ${where}`).get(...params).n;
  }

  /** Counts per status, for all reports and for each type: { all: {...}, url: {...}, ... } */
  static statsByType() {
    const empty = () => ({ total: 0, pending: 0, reviewed: 0, dismissed: 0, blocked: 0 });
    const stats = { all: empty() };
    for (const type of this.TYPES) stats[type] = empty();

    const rows = db.prepare('SELECT targetType, status, COUNT(*) AS n FROM reports GROUP BY targetType, status').all();
    for (const { targetType, status, n } of rows) {
      for (const bucket of [stats.all, stats[targetType]]) {
        if (!bucket) continue;
        bucket.total += n;
        if (status in bucket) bucket[status] += n;
      }
    }
    return stats;
  }

  static updateStatus(id, status, reviewerId) {
    db.prepare('UPDATE reports SET status = ?, reviewedBy = ?, reviewedAt = CURRENT_TIMESTAMP WHERE id = ?')
      .run(status, reviewerId, id);
    return this.findById(id);
  }

  /** Mark every pending report on an item as `status` (moderation decisions). */
  static resolvePending(targetType, targetId, status, reviewerId) {
    db.prepare(`
      UPDATE reports SET status = ?, reviewedBy = ?, reviewedAt = CURRENT_TIMESTAMP
      WHERE targetType = ? AND targetId = ? AND status = 'pending'
    `).run(status, reviewerId, targetType, targetId);
  }

  static delete(id) {
    return db.prepare('DELETE FROM reports WHERE id = ?').run(id).changes > 0;
  }
}

module.exports = Report;
