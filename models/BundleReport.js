const db = require('../config/database');
const crypto = require('crypto');

class BundleReport {
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

  static create({ bundleId, reporterIp, reason, description }) {
    const reporterIpHash = crypto.createHash('sha256').update(reporterIp).digest('hex');
    const stmt = db.prepare(`
      INSERT INTO bundle_reports (bundleId, reporterIpHash, reason, description)
      VALUES (?, ?, ?, ?)
    `);
    const result = stmt.run(bundleId, reporterIpHash, reason, description || null);
    return this.findById(result.lastInsertRowid);
  }

  static findById(id) {
    return db.prepare('SELECT * FROM bundle_reports WHERE id = ?').get(id);
  }

  static findAll(status = null, limit = 50, offset = 0) {
    let query = `
      SELECT r.*, b.slug, b.title, b.clicks, b.isBlocked, b.creatorId,
        b.createdAt as bundleCreatedAt,
        creator.username as creatorUsername, creator.isBanned as creatorIsBanned,
        reviewer.username as reviewerUsername
      FROM bundle_reports r
      JOIN bundles b ON r.bundleId = b.id
      LEFT JOIN users creator ON b.creatorId = creator.id
      LEFT JOIN users reviewer ON r.reviewedBy = reviewer.id
    `;
    const params = [];
    if (status) {
      query += ' WHERE r.status = ?';
      params.push(status);
    }
    query += ' ORDER BY r.createdAt DESC';
    if (limit !== null) {
      query += ' LIMIT ? OFFSET ?';
      params.push(limit, offset);
    }
    return db.prepare(query).all(...params);
  }

  static count(status = null) {
    let query = 'SELECT COUNT(*) as count FROM bundle_reports';
    const params = [];
    if (status) {
      query += ' WHERE status = ?';
      params.push(status);
    }
    const result = db.prepare(query).get(...params);
    return result ? result.count : 0;
  }

  static countByBundleId(bundleId) {
    const result = db.prepare("SELECT COUNT(*) as count FROM bundle_reports WHERE bundleId = ? AND status = 'pending'").get(bundleId);
    return result ? result.count : 0;
  }

  static hasReported(bundleId, reporterIp) {
    const reporterIpHash = crypto.createHash('sha256').update(reporterIp).digest('hex');
    return db.prepare('SELECT id FROM bundle_reports WHERE bundleId = ? AND reporterIpHash = ?').get(bundleId, reporterIpHash) !== undefined;
  }

  static updateStatus(id, status, reviewerId) {
    db.prepare(`
      UPDATE bundle_reports
      SET status = ?, reviewedBy = ?, reviewedAt = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, reviewerId, id);
    return this.findById(id);
  }

  static delete(id) {
    const result = db.prepare('DELETE FROM bundle_reports WHERE id = ?').run(id);
    return result.changes > 0;
  }

  static getStats() {
    return db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'reviewed' THEN 1 ELSE 0 END) as reviewed,
        SUM(CASE WHEN status = 'dismissed' THEN 1 ELSE 0 END) as dismissed,
        SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) as blocked
      FROM bundle_reports
    `).get();
  }
}

module.exports = BundleReport;
