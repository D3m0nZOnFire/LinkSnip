const db = require('../config/database');
const crypto = require('crypto');

class Report {
  /**
   * Report reasons (enum)
   */
  static REASONS = {
    FRAUD: 'Fraud/Scam',
    PHISHING: 'Phishing',
    MALWARE: 'Malware',
    SPAM: 'Spam',
    ADULT: 'Adult Content',
    COPYRIGHT: 'Copyright Violation',
    OTHER: 'Other'
  };

  /**
   * Report statuses (enum)
   */
  static STATUSES = {
    PENDING: 'pending',
    REVIEWED: 'reviewed',
    DISMISSED: 'dismissed',
    BLOCKED: 'blocked'
  };

  /**
   * Create a new report
   * @param {object} data - { urlId, reporterIp, reason, description }
   * @returns {object} Created report record
   */
  static create({ urlId, reporterIp, reason, description }) {
    // Hash the IP for privacy
    const reporterIpHash = crypto.createHash('sha256').update(reporterIp).digest('hex');

    const stmt = db.prepare(`
      INSERT INTO url_reports (urlId, reporterIpHash, reason, description)
      VALUES (?, ?, ?, ?)
    `);

    const result = stmt.run(urlId, reporterIpHash, reason, description || null);
    return this.findById(result.lastInsertRowid);
  }

  /**
   * Find report by ID
   * @param {number} id
   * @returns {object|null} Report record
   */
  static findById(id) {
    const stmt = db.prepare('SELECT * FROM url_reports WHERE id = ?');
    return stmt.get(id);
  }

  /**
   * Find all reports for a specific URL
   * @param {number} urlId
   * @returns {array} Array of report records
   */
  static findByUrlId(urlId) {
    const stmt = db.prepare(`
      SELECT * FROM url_reports
      WHERE urlId = ?
      ORDER BY createdAt DESC
    `);
    return stmt.all(urlId);
  }

  /**
   * Get all pending reports
   * @returns {array} Array of reports with URL info
   */
  static getPendingReports() {
    const stmt = db.prepare(`
      SELECT
        r.*,
        u.slug,
        u.longUrl,
        u.clicks,
        u.createdAt as urlCreatedAt,
        creator.username as creatorUsername
      FROM url_reports r
      JOIN urls u ON r.urlId = u.id
      LEFT JOIN users creator ON u.creatorId = creator.id
      WHERE r.status = 'pending'
      ORDER BY r.createdAt DESC
    `);
    return stmt.all();
  }

  /**
   * Get all reports with pagination
   * @param {string} status - Filter by status (optional)
   * @param {number} limit - Number per page
   * @param {number} offset - Offset for pagination
   * @returns {array} Array of reports with URL info
   */
  static findAll(status = null, limit = 50, offset = 0) {
    let query = `
      SELECT
        r.*,
        u.slug,
        u.longUrl,
        u.clicks,
        u.isBlocked,
        u.creatorId,
        u.createdAt as urlCreatedAt,
        creator.username as creatorUsername,
        creator.isBanned as creatorIsBanned,
        reviewer.username as reviewerUsername
      FROM url_reports r
      JOIN urls u ON r.urlId = u.id
      LEFT JOIN users creator ON u.creatorId = creator.id
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

    const stmt = db.prepare(query);
    return stmt.all(...params);
  }

  /**
   * Count reports
   * @param {string} status - Filter by status (optional)
   * @returns {number} Total count
   */
  static count(status = null) {
    let query = 'SELECT COUNT(*) as count FROM url_reports';
    const params = [];

    if (status) {
      query += ' WHERE status = ?';
      params.push(status);
    }

    const stmt = db.prepare(query);
    const result = stmt.get(...params);
    return result ? result.count : 0;
  }

  /**
   * Count pending reports for a specific URL
   * @param {number} urlId
   * @returns {number} Total count of pending reports
   */
  static countByUrlId(urlId) {
    const stmt = db.prepare("SELECT COUNT(*) as count FROM url_reports WHERE urlId = ? AND status = 'pending'");
    const result = stmt.get(urlId);
    return result ? result.count : 0;
  }

  /**
   * Update report status
   * @param {number} id - Report ID
   * @param {string} status - New status
   * @param {number} reviewerId - Admin user ID
   * @returns {object} Updated report
   */
  static updateStatus(id, status, reviewerId) {
    const stmt = db.prepare(`
      UPDATE url_reports
      SET status = ?, reviewedBy = ?, reviewedAt = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    stmt.run(status, reviewerId, id);
    return this.findById(id);
  }

  /**
   * Delete a report
   * @param {number} id
   * @returns {boolean} True if deleted
   */
  static delete(id) {
    const stmt = db.prepare('DELETE FROM url_reports WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  /**
   * Check if IP has already reported this URL (prevent spam)
   * @param {number} urlId
   * @param {string} reporterIp
   * @returns {boolean} True if already reported
   */
  static hasReported(urlId, reporterIp) {
    const reporterIpHash = crypto.createHash('sha256').update(reporterIp).digest('hex');

    const stmt = db.prepare(`
      SELECT id FROM url_reports
      WHERE urlId = ? AND reporterIpHash = ?
    `);

    return stmt.get(urlId, reporterIpHash) !== undefined;
  }

  /**
   * Get report statistics
   * @returns {object} Statistics
   */
  static getStats() {
    const stmt = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'reviewed' THEN 1 ELSE 0 END) as reviewed,
        SUM(CASE WHEN status = 'dismissed' THEN 1 ELSE 0 END) as dismissed,
        SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) as blocked
      FROM url_reports
    `);

    return stmt.get();
  }
}

module.exports = Report;
