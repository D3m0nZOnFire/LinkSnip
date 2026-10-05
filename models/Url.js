const db = require('../config/database');
const Tag = require('./Tag');
const { scopeCondition } = require('../services/itemScope');

class Url {
  /**
   * Create a new shortened URL
   * @param {object} data - { slug, longUrl, creatorId, maxUses, expiresAt, password, activateAt, deactivateAt }
   * @returns {object} Created URL record
   */
  static create({ slug, longUrl, creatorId, maxUses, expiresAt, password, activateAt, deactivateAt }) {
    const stmt = db.prepare(`
      INSERT INTO urls (slug, longUrl, creatorId, maxUses, expiresAt, password, activateAt, deactivateAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      slug,
      longUrl,
      creatorId,
      maxUses || null,
      expiresAt || null,
      password || null,
      activateAt || null,
      deactivateAt || null
    );

    return this.findById(result.lastInsertRowid);
  }

  /**
   * Find URL by slug
   * @param {string} slug 
   * @returns {object|null} URL record
   */
  static findBySlug(slug) {
    const stmt = db.prepare('SELECT * FROM urls WHERE slug = ? COLLATE NOCASE');
    return stmt.get(slug);
  }

  /**
   * Find URL by ID
   * @param {number} id 
   * @returns {object|null} URL record
   */
  static findById(id) {
    const stmt = db.prepare('SELECT * FROM urls WHERE id = ?');
    return stmt.get(id);
  }

  /**
   * Find a user's personal links, or a team's (with tags and report counts)
   * @param {number|object} creatorId - A user ID, { userId } or { teamId } (services/itemScope.js)
   * @param {number} limit - Number of URLs per page (null = all)
   * @param {number} offset - Number of URLs to skip
   * @returns {array} Array of URL records with tags and report counts
   */
  static findByCreatorId(creatorId, limit = null, offset = 0) {
    const scope = scopeCondition('url', creatorId);
    let query = `
      SELECT
        urls.*,
        creator.username AS creatorUsername,
        COUNT(CASE WHEN reports.status = 'pending' THEN 1 END) as reportCount
      FROM urls
      LEFT JOIN users creator ON creator.id = urls.creatorId
      LEFT JOIN reports ON reports.targetType = 'url' AND reports.targetId = urls.id
      WHERE ${scope.sql}
      GROUP BY urls.id
      ORDER BY urls.createdAt DESC
    `;

    const params = [...scope.params];

    if (limit !== null) {
      query += ' LIMIT ? OFFSET ?';
      params.push(limit, offset);
    }

    const stmt = db.prepare(query);
    const urls = stmt.all(...params);

    // Attach tags to each URL
    return urls.map(url => ({
      ...url,
      tags: Tag.forItem('url', url.id)
    }));
  }

  /**
   * Count total URLs for a creator
   * @param {number} creatorId
   * @returns {number} Total count
   */
  static countByCreatorId(creatorId) {
    const stmt = db.prepare('SELECT COUNT(*) as count FROM urls WHERE creatorId = ?');
    const result = stmt.get(creatorId);
    return result ? result.count : 0;
  }

  /**
   * Get a user's personal links, or a team's, with search + sort support
   * @param {number|object} creatorId - A user ID, { userId } or { teamId }
   * @param {object} options - { limit, offset, search, sort }
   */
  static findByCreatorIdWithFilters(creatorId, options = {}) {
    const { limit = null, offset = 0, search = '', sort = 'newest' } = options;

    const scope = scopeCondition('url', creatorId);
    let query = `
      SELECT urls.*, creator.username AS creatorUsername,
        COUNT(CASE WHEN reports.status = 'pending' THEN 1 END) as reportCount
      FROM urls
      LEFT JOIN users creator ON creator.id = urls.creatorId
      LEFT JOIN reports ON reports.targetType = 'url' AND reports.targetId = urls.id
      WHERE ${scope.sql}
    `;
    const params = [...scope.params];

    if (search && search.trim()) {
      query += ` AND (urls.slug LIKE ? OR urls.longUrl LIKE ?)`;
      const term = `%${search.trim()}%`;
      params.push(term, term);
    }

    query += ` GROUP BY urls.id`;

    switch (sort) {
      case 'oldest': query += ` ORDER BY urls.createdAt ASC`; break;
      case 'most-clicks': query += ` ORDER BY urls.clicks DESC`; break;
      case 'least-clicks': query += ` ORDER BY urls.clicks ASC`; break;
      default: query += ` ORDER BY urls.createdAt DESC`; break;
    }

    if (limit !== null) {
      query += ' LIMIT ? OFFSET ?';
      params.push(limit, offset);
    }

    const urls = db.prepare(query).all(...params);
    return urls.map(url => ({ ...url, tags: Tag.forItem('url', url.id) }));
  }

  /**
   * Count a user's personal links, or a team's, with search support
   * @param {number|object} creatorId - A user ID, { userId } or { teamId }
   * @param {object} options - { search }
   */
  static countByCreatorIdWithFilters(creatorId, options = {}) {
    const { search = '' } = options;
    const scope = scopeCondition('url', creatorId);
    let query = `SELECT COUNT(*) as count FROM urls WHERE ${scope.sql}`;
    const params = [...scope.params];

    if (search && search.trim()) {
      query += ` AND (slug LIKE ? OR longUrl LIKE ?)`;
      const term = `%${search.trim()}%`;
      params.push(term, term);
    }

    const result = db.prepare(query).get(...params);
    return result ? result.count : 0;
  }

  /**
   * Get all URLs (for admin) with tags and report counts
   * @param {number} limit - Number of URLs per page (null = all)
   * @param {number} offset - Number of URLs to skip
   * @returns {array} Array of URL records with username, tags, and report counts
   */
  static findAll(limit = null, offset = 0) {
    let query = `
      SELECT
        urls.*,
        users.username as creatorUsername,
        users.isAdmin as creatorIsAdmin,
        COUNT(CASE WHEN reports.status = 'pending' THEN 1 END) as reportCount
      FROM urls
      LEFT JOIN users ON urls.creatorId = users.id
      LEFT JOIN reports ON reports.targetType = 'url' AND reports.targetId = urls.id
      GROUP BY urls.id
      ORDER BY urls.createdAt DESC
    `;

    const params = [];

    if (limit !== null) {
      query += ' LIMIT ? OFFSET ?';
      params.push(limit, offset);
    }

    const stmt = db.prepare(query);
    const urls = stmt.all(...params);

    // Attach tags to each URL
    return urls.map(url => ({
      ...url,
      tags: Tag.forItem('url', url.id)
    }));
  }

  /**
   * Count total URLs (for admin)
   * @returns {number} Total count
   */
  static countAll() {
    const stmt = db.prepare('SELECT COUNT(*) as count FROM urls');
    const result = stmt.get();
    return result ? result.count : 0;
  }

  /**
   * Increment click counter
   * @param {string} slug 
   * @returns {number} New click count
   */
  static incrementClicks(slug) {
    const stmt = db.prepare('UPDATE urls SET clicks = clicks + 1 WHERE slug = ? COLLATE NOCASE');
    stmt.run(slug);
    
    const url = this.findBySlug(slug);
    return url ? url.clicks : 0;
  }

  /**
   * Update URL
   * @param {number} id
   * @param {object} data - { longUrl, maxUses, expiresAt, password, activateAt, deactivateAt }
   * @returns {object} Updated URL record
   */
  static update(id, { longUrl, maxUses, expiresAt, password, activateAt, deactivateAt }) {
    // If password is explicitly set to empty string or null, remove it
    // If password is undefined, keep existing password (don't update)
    let stmt;
    let params;

    if (password === '' || password === null) {
      // Remove password
      stmt = db.prepare(`
        UPDATE urls
        SET longUrl = ?, maxUses = ?, expiresAt = ?, password = NULL, activateAt = ?, deactivateAt = ?
        WHERE id = ?
      `);
      params = [longUrl, maxUses || null, expiresAt || null, activateAt || null, deactivateAt || null, id];
    } else if (password !== undefined) {
      // Update password (password is hashed already)
      stmt = db.prepare(`
        UPDATE urls
        SET longUrl = ?, maxUses = ?, expiresAt = ?, password = ?, activateAt = ?, deactivateAt = ?
        WHERE id = ?
      `);
      params = [longUrl, maxUses || null, expiresAt || null, password, activateAt || null, deactivateAt || null, id];
    } else {
      // Don't update password field
      stmt = db.prepare(`
        UPDATE urls
        SET longUrl = ?, maxUses = ?, expiresAt = ?, activateAt = ?, deactivateAt = ?
        WHERE id = ?
      `);
      params = [longUrl, maxUses || null, expiresAt || null, activateAt || null, deactivateAt || null, id];
    }

    stmt.run(...params);
    return this.findById(id);
  }

  /**
   * Delete URL
   * @param {number} id 
   * @returns {boolean} True if deleted
   */
  static delete(id) {
    const stmt = db.prepare('DELETE FROM urls WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  /**
   * Block a URL
   * @param {number} id - URL ID
   * @returns {boolean} True if blocked
   */
  static block(id) {
    const stmt = db.prepare('UPDATE urls SET isBlocked = 1 WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  /**
   * Unblock a URL
   * @param {number} id - URL ID
   * @returns {boolean} True if unblocked
   */
  static unblock(id) {
    const stmt = db.prepare('UPDATE urls SET isBlocked = 0 WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  /**
   * Delete inactive anonymous URLs (expired or past deactivateAt) immediately
   * @returns {number} Number of URLs deleted
   */
  static deleteInactiveAnonymous() {
    const stmt = db.prepare(`
      DELETE FROM urls
      WHERE creatorId IS NULL
        AND (
          (expiresAt IS NOT NULL AND datetime(expiresAt) < datetime('now'))
          OR
          (deactivateAt IS NOT NULL AND datetime(deactivateAt) < datetime('now'))
        )
    `);
    const result = stmt.run();
    return result.changes;
  }

  /**
   * Delete inactive registered-user URLs past the grace period
   * A URL is inactive if expiresAt or deactivateAt is in the past
   * @param {number} graceDays - Days after becoming inactive before deletion
   * @returns {number} Number of URLs deleted
   */
  static deleteInactiveRegistered(graceDays = 90) {
    const stmt = db.prepare(`
      DELETE FROM urls
      WHERE creatorId IS NOT NULL
        AND (
          (expiresAt IS NOT NULL AND julianday('now') > julianday(expiresAt) + ?)
          OR
          (deactivateAt IS NOT NULL AND julianday('now') > julianday(deactivateAt) + ?)
        )
    `);
    const result = stmt.run(graceDays, graceDays);
    return result.changes;
  }
}

module.exports = Url;