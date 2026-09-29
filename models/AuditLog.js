const db = require('../config/database');

/**
 * AuditLog Model
 * Tracks all important actions in the system for security and compliance
 *
 * Categories:
 * - AUTH: Login, logout, failed attempts
 * - ADMIN_ACTION: User bans, URL blocks, permission changes
 * - ACCOUNT_CHANGE: Password/email changes
 * - SECURITY: Suspicious activities, report reviews
 */
class AuditLog {
  /**
   * Create a new audit log entry
   * @param {Object} logData - Log entry data
   * @param {number} logData.userId - User who performed the action (null for system actions)
   * @param {string} logData.username - Username for quick reference
   * @param {string} logData.action - Action performed (e.g., "LOGIN", "BAN_USER", "DELETE_URL")
   * @param {string} logData.category - Category (AUTH, ADMIN_ACTION, ACCOUNT_CHANGE, SECURITY)
   * @param {string} [logData.targetType] - Type of target (user, url, report, etc.)
   * @param {number} [logData.targetId] - ID of the affected resource
   * @param {string} [logData.targetDescription] - Human-readable description
   * @param {string} [logData.ipAddress] - IP address of the user
   * @param {string} [logData.userAgent] - User agent string
   * @param {string} [logData.details] - Additional JSON details
   * @returns {Object} The created audit log entry
   */
  static create(logData) {
    const stmt = db.prepare(`
      INSERT INTO audit_logs (
        userId, username, action, category, targetType, targetId,
        targetDescription, ipAddress, userAgent, details
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      logData.userId || null,
      logData.username || null,
      logData.action,
      logData.category,
      logData.targetType || null,
      logData.targetId || null,
      logData.targetDescription || null,
      logData.ipAddress || null,
      logData.userAgent || null,
      logData.details || null
    );

    return this.findById(result.lastInsertRowid);
  }

  /**
   * Find audit log by ID
   */
  static findById(id) {
    const stmt = db.prepare('SELECT * FROM audit_logs WHERE id = ?');
    return stmt.get(id);
  }

  /**
   * Get all audit logs with pagination and filtering
   * @param {Object} options - Query options
   * @param {number} [options.limit] - Number of results (default 50)
   * @param {number} [options.offset] - Offset for pagination (default 0)
   * @param {string} [options.category] - Filter by category
   * @param {string} [options.action] - Filter by action
   * @param {number} [options.userId] - Filter by user
   * @param {string} [options.search] - Search in action, username, targetDescription
   * @returns {Array} Array of audit log entries
   */
  static findAll(options = {}) {
    const {
      limit = 50,
      offset = 0,
      category,
      action,
      userId,
      search
    } = options;

    let query = 'SELECT * FROM audit_logs WHERE 1=1';
    const params = [];

    if (category) {
      query += ' AND category = ?';
      params.push(category);
    }

    if (action) {
      query += ' AND action = ?';
      params.push(action);
    }

    if (userId) {
      query += ' AND userId = ?';
      params.push(userId);
    }

    if (search) {
      query += ' AND (action LIKE ? OR username LIKE ? OR targetDescription LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    query += ' ORDER BY createdAt DESC';

    if (limit !== null) {
      query += ' LIMIT ? OFFSET ?';
      params.push(limit, offset);
    }

    const stmt = db.prepare(query);
    return stmt.all(...params);
  }

  /**
   * Count audit logs with optional filters
   * @param {Object} options - Filter options
   * @returns {number} Total count
   */
  static count(options = {}) {
    const { category, action, userId, search } = options;

    let query = 'SELECT COUNT(*) as count FROM audit_logs WHERE 1=1';
    const params = [];

    if (category) {
      query += ' AND category = ?';
      params.push(category);
    }

    if (action) {
      query += ' AND action = ?';
      params.push(action);
    }

    if (userId) {
      query += ' AND userId = ?';
      params.push(userId);
    }

    if (search) {
      query += ' AND (action LIKE ? OR username LIKE ? OR targetDescription LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    const stmt = db.prepare(query);
    const result = stmt.get(...params);
    return result.count;
  }

  /**
   * Get recent logs for a specific user
   * @param {number} userId - User ID
   * @param {number} limit - Number of results (default 10)
   * @returns {Array} Recent audit logs
   */
  static findByUserId(userId, limit = 10) {
    const stmt = db.prepare(`
      SELECT * FROM audit_logs
      WHERE userId = ?
      ORDER BY createdAt DESC
      LIMIT ?
    `);
    return stmt.all(userId, limit);
  }

  /**
   * Get logs for a specific target (e.g., all logs related to a specific URL or user)
   * @param {string} targetType - Type of target (url, user, report, etc.)
   * @param {number} targetId - ID of the target
   * @param {number} limit - Number of results (default 20)
   * @returns {Array} Audit logs for the target
   */
  static findByTarget(targetType, targetId, limit = 20) {
    const stmt = db.prepare(`
      SELECT * FROM audit_logs
      WHERE targetType = ? AND targetId = ?
      ORDER BY createdAt DESC
      LIMIT ?
    `);
    return stmt.all(targetType, targetId, limit);
  }

  /**
   * Get all categories (for filtering UI)
   * @returns {Array} List of unique categories
   */
  static getCategories() {
    const stmt = db.prepare('SELECT DISTINCT category FROM audit_logs ORDER BY category');
    return stmt.all().map(row => row.category);
  }

  /**
   * Get all actions (for filtering UI)
   * @returns {Array} List of unique actions
   */
  static getActions() {
    const stmt = db.prepare('SELECT DISTINCT action FROM audit_logs ORDER BY action');
    return stmt.all().map(row => row.action);
  }

  /**
   * Delete old audit logs (cleanup job)
   * @param {number} days - Delete logs older than this many days (default 90)
   * @returns {number} Number of deleted records
   */
  static deleteOlderThan(days = 90) {
    const stmt = db.prepare(`
      DELETE FROM audit_logs
      WHERE createdAt < datetime('now', '-' || ? || ' days')
    `);
    const result = stmt.run(days);
    return result.changes;
  }

  /**
   * Get audit log statistics
   * @returns {Object} Statistics object with counts by category
   */
  static getStats() {
    const stmt = db.prepare(`
      SELECT
        category,
        COUNT(*) as count
      FROM audit_logs
      GROUP BY category
      ORDER BY count DESC
    `);
    return stmt.all();
  }
}

module.exports = AuditLog;
