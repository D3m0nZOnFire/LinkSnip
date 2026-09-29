const db = require('../config/database');
const Tag = require('./Tag');

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
    const stmt = db.prepare('SELECT * FROM urls WHERE slug = ?');
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
   * Find all URLs by creator ID (with tags and report counts)
   * @param {number} creatorId
   * @param {number} limit - Number of URLs per page (null = all)
   * @param {number} offset - Number of URLs to skip
   * @returns {array} Array of URL records with tags and report counts
   */
  static findByCreatorId(creatorId, limit = null, offset = 0) {
    let query = `
      SELECT
        urls.*,
        COUNT(CASE WHEN url_reports.status = 'pending' THEN 1 END) as reportCount
      FROM urls
      LEFT JOIN url_reports ON urls.id = url_reports.urlId
      WHERE creatorId = ?
      GROUP BY urls.id
      ORDER BY urls.createdAt DESC
    `;

    const params = [creatorId];

    if (limit !== null) {
      query += ' LIMIT ? OFFSET ?';
      params.push(limit, offset);
    }

    const stmt = db.prepare(query);
    const urls = stmt.all(...params);

    // Attach tags to each URL
    return urls.map(url => ({
      ...url,
      tags: Tag.findByUrlId(url.id)
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
   * Get URLs for a creator with search + sort support
   * @param {number} creatorId
   * @param {object} options - { limit, offset, search, sort }
   */
  static findByCreatorIdWithFilters(creatorId, options = {}) {
    const { limit = null, offset = 0, search = '', sort = 'newest' } = options;

    let query = `
      SELECT urls.*, COUNT(CASE WHEN url_reports.status = 'pending' THEN 1 END) as reportCount
      FROM urls
      LEFT JOIN url_reports ON urls.id = url_reports.urlId
      WHERE urls.creatorId = ?
    `;
    const params = [creatorId];

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
    return urls.map(url => ({ ...url, tags: Tag.findByUrlId(url.id) }));
  }

  /**
   * Count URLs for a creator with search support
   * @param {number} creatorId
   * @param {object} options - { search }
   */
  static countByCreatorIdWithFilters(creatorId, options = {}) {
    const { search = '' } = options;
    let query = `SELECT COUNT(*) as count FROM urls WHERE creatorId = ?`;
    const params = [creatorId];

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
        COUNT(CASE WHEN url_reports.status = 'pending' THEN 1 END) as reportCount
      FROM urls
      LEFT JOIN users ON urls.creatorId = users.id
      LEFT JOIN url_reports ON urls.id = url_reports.urlId
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
      tags: Tag.findByUrlId(url.id)
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
   * Build SQL conditions and params for a single OR filter group.
   * Used by findAllWithFilters / countAllWithFilters.
   * @param {object} group - { cleanSearch, creatorUsernames, excludeCreatorUsernames, groupStatus, isAnonymous, isProtected, minClicks, maxClicks }
   * @param {string} globalStatus - Fallback status when group has no @status: token
   * @param {string} now - ISO timestamp for date comparisons
   * @returns {{ conditions: string[], params: any[] }}
   */
  static _buildGroupSQL(group, globalStatus, now) {
    const {
      cleanSearch = '',
      creatorUsernames = [],
      excludeCreatorUsernames = [],
      groupStatus = '',
      isAnonymous = false,
      isProtected = false,
      minClicks = null,
      maxClicks = null
    } = group;

    const conditions = [];
    const params = [];

    if (cleanSearch && cleanSearch.trim()) {
      conditions.push(`(urls.slug LIKE ? OR urls.longUrl LIKE ? OR users.username LIKE ?)`);
      const t = `%${cleanSearch.trim()}%`;
      params.push(t, t, t);
    }

    // Creator filter: @user:alice,bob OR @user:anon — all OR together into one condition
    // isAnonymous is merged here so that @user:ivo,anon works as (username LIKE ? OR creatorId IS NULL)
    const creatorParts = [];
    const creatorParams = [];
    if (Array.isArray(creatorUsernames) && creatorUsernames.length > 0) {
      const phs = creatorUsernames.map(() => 'users.username LIKE ?').join(' OR ');
      creatorParts.push(`(${phs})`);
      creatorUsernames.forEach(u => creatorParams.push(`%${u}%`));
    }
    if (isAnonymous) creatorParts.push(`urls.creatorId IS NULL`);
    if (creatorParts.length === 1) {
      conditions.push(creatorParts[0]);
      params.push(...creatorParams);
    } else if (creatorParts.length > 1) {
      conditions.push(`(${creatorParts.join(' OR ')})`);
      params.push(...creatorParams);
    }

    // @user:!alice @user:!bob — each exclusion ANDs together
    if (Array.isArray(excludeCreatorUsernames) && excludeCreatorUsernames.length > 0) {
      const notLikes = excludeCreatorUsernames.map(() => 'users.username NOT LIKE ?').join(' AND ');
      conditions.push(`(users.username IS NULL OR (${notLikes}))`);
      excludeCreatorUsernames.forEach(u => params.push(`%${u.trim()}%`));
    }

    if (minClicks !== null && minClicks === maxClicks) {
      conditions.push(`urls.clicks = ?`); params.push(minClicks);
    } else {
      if (minClicks !== null) { conditions.push(`urls.clicks >= ?`); params.push(minClicks); }
      if (maxClicks !== null) { conditions.push(`urls.clicks <= ?`); params.push(maxClicks); }
    }

    // @protected is an additive AND condition — stacks with @status: instead of replacing it
    if (isProtected) conditions.push(`urls.password IS NOT NULL`);

    const effectiveStatus = groupStatus || globalStatus || '';
    if (effectiveStatus) {
      switch (effectiveStatus) {
        case 'active':
          conditions.push(`urls.isBlocked = 0`);
          conditions.push(`(urls.expiresAt IS NULL OR urls.expiresAt > ?)`);
          conditions.push(`(urls.activateAt IS NULL OR urls.activateAt <= ?)`);
          conditions.push(`(urls.deactivateAt IS NULL OR urls.deactivateAt > ?)`);
          params.push(now, now, now);
          break;
        case 'blocked':
          conditions.push(`urls.isBlocked = 1`);
          break;
        case 'expired':
          conditions.push(`((urls.expiresAt IS NOT NULL AND urls.expiresAt < ?) OR (urls.deactivateAt IS NOT NULL AND urls.deactivateAt < ?))`);
          params.push(now, now);
          break;
        case 'scheduled':
          conditions.push(`urls.activateAt IS NOT NULL AND urls.activateAt > ?`);
          params.push(now);
          break;
        case 'max-uses':
          conditions.push(`urls.maxUses IS NOT NULL AND urls.clicks >= urls.maxUses`);
          break;
        case 'anonymous':
          conditions.push(`urls.creatorId IS NULL`);
          break;
        case 'password-protected':
          conditions.push(`urls.password IS NOT NULL`);
          break;
      }
    }

    return { conditions, params };
  }

  /**
   * Get all URLs with filters (for admin)
   * filterGroups is an array of OR groups — conditions within each group are ANDed, groups are ORed.
   * @param {object} options - { limit, offset, filterGroups, status, hasReports, sort, dateFrom, dateTo }
   * @returns {array} Array of URL records with username, tags, and report counts
   */
  static findAllWithFilters(options = {}) {
    const {
      limit = null,
      offset = 0,
      filterGroups = [],
      status = '',
      hasReports = '',
      sort = 'newest',
      dateFrom = '',
      dateTo = ''
    } = options;

    let query = `
      SELECT
        urls.*,
        users.username as creatorUsername,
        users.isAdmin as creatorIsAdmin,
        COUNT(CASE WHEN url_reports.status = 'pending' THEN 1 END) as reportCount
      FROM urls
      LEFT JOIN users ON urls.creatorId = users.id
      LEFT JOIN url_reports ON urls.id = url_reports.urlId
    `;

    const allConditions = [];
    const params = [];
    const now = new Date().toISOString();

    // Global date range (always ANDed, outside OR groups)
    if (dateFrom && dateFrom.trim()) {
      allConditions.push(`DATE(urls.createdAt) >= ?`);
      params.push(dateFrom.trim());
    }
    if (dateTo && dateTo.trim()) {
      allConditions.push(`DATE(urls.createdAt) <= ?`);
      params.push(dateTo.trim());
    }

    // Build OR groups — each group's conditions are ANDed, groups are ORed together
    if (filterGroups.length > 0) {
      const orParts = [];
      const orParams = [];
      let hasEmptyGroup = false;

      for (const group of filterGroups) {
        const { conditions: gc, params: gp } = Url._buildGroupSQL(group, status, now);
        if (gc.length === 0) {
          // An empty group matches everything — the whole OR expression is always true
          hasEmptyGroup = true;
          break;
        }
        orParts.push(`(${gc.join(' AND ')})`);
        orParams.push(...gp);
      }

      if (!hasEmptyGroup && orParts.length > 0) {
        allConditions.push(orParts.length === 1 ? orParts[0] : `(${orParts.join(' OR ')})`);
        params.push(...orParams);
      }
    } else if (status) {
      // No filterGroups but a bare status param — apply it directly (backward-compatible)
      const { conditions: gc, params: gp } = Url._buildGroupSQL({}, status, now);
      if (gc.length > 0) {
        allConditions.push(...gc);
        params.push(...gp);
      }
    }

    if (allConditions.length > 0) {
      query += ` WHERE ${allConditions.join(' AND ')}`;
    }

    query += ` GROUP BY urls.id`;

    // Has reports filter (needs HAVING since reportCount is aggregated)
    if (hasReports === 'yes') {
      query += ` HAVING reportCount > 0`;
    } else if (hasReports === 'no') {
      query += ` HAVING reportCount = 0`;
    }

    switch (sort) {
      case 'oldest':
        query += ` ORDER BY urls.createdAt ASC`;
        break;
      case 'most-clicks':
        query += ` ORDER BY urls.clicks DESC`;
        break;
      case 'least-clicks':
        query += ` ORDER BY urls.clicks ASC`;
        break;
      case 'most-reports':
        query += ` ORDER BY reportCount DESC, urls.createdAt DESC`;
        break;
      case 'newest':
      default:
        query += ` ORDER BY urls.createdAt DESC`;
        break;
    }

    if (limit !== null) {
      query += ' LIMIT ? OFFSET ?';
      params.push(limit, offset);
    }

    const urls = db.prepare(query).all(...params);

    return urls.map(url => ({
      ...url,
      tags: Tag.findByUrlId(url.id)
    }));
  }

  /**
   * Count URLs with filters (for admin pagination)
   * @param {object} options - { filterGroups, status, hasReports, dateFrom, dateTo }
   * @returns {number} Total count matching filters
   */
  static countAllWithFilters(options = {}) {
    const { filterGroups = [], status = '', hasReports = '', dateFrom = '', dateTo = '' } = options;

    // For counting with HAVING clause, we need a subquery
    let query = `
      SELECT COUNT(*) as count FROM (
        SELECT urls.id, COUNT(CASE WHEN url_reports.status = 'pending' THEN 1 END) as reportCount
        FROM urls
        LEFT JOIN users ON urls.creatorId = users.id
        LEFT JOIN url_reports ON urls.id = url_reports.urlId
    `;

    const allConditions = [];
    const params = [];
    const now = new Date().toISOString();

    if (dateFrom && dateFrom.trim()) {
      allConditions.push(`DATE(urls.createdAt) >= ?`);
      params.push(dateFrom.trim());
    }
    if (dateTo && dateTo.trim()) {
      allConditions.push(`DATE(urls.createdAt) <= ?`);
      params.push(dateTo.trim());
    }

    if (filterGroups.length > 0) {
      const orParts = [];
      const orParams = [];
      let hasEmptyGroup = false;

      for (const group of filterGroups) {
        const { conditions: gc, params: gp } = Url._buildGroupSQL(group, status, now);
        if (gc.length === 0) {
          hasEmptyGroup = true;
          break;
        }
        orParts.push(`(${gc.join(' AND ')})`);
        orParams.push(...gp);
      }

      if (!hasEmptyGroup && orParts.length > 0) {
        allConditions.push(orParts.length === 1 ? orParts[0] : `(${orParts.join(' OR ')})`);
        params.push(...orParams);
      }
    } else if (status) {
      // No filterGroups but a bare status param — apply it directly (backward-compatible)
      const { conditions: gc, params: gp } = Url._buildGroupSQL({}, status, now);
      if (gc.length > 0) {
        allConditions.push(...gc);
        params.push(...gp);
      }
    }

    if (allConditions.length > 0) {
      query += ` WHERE ${allConditions.join(' AND ')}`;
    }

    query += ` GROUP BY urls.id`;

    if (hasReports === 'yes') {
      query += ` HAVING reportCount > 0`;
    } else if (hasReports === 'no') {
      query += ` HAVING reportCount = 0`;
    }

    query += `)`;

    const result = db.prepare(query).get(...params);
    return result ? result.count : 0;
  }

  /**
   * Increment click counter
   * @param {string} slug 
   * @returns {number} New click count
   */
  static incrementClicks(slug) {
    const stmt = db.prepare('UPDATE urls SET clicks = clicks + 1 WHERE slug = ?');
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
   * Check if URL is valid (not expired, not exceeded max uses, and within activation schedule)
   * @param {object} url - URL record
   * @returns {object} { valid, reason, status }
   */
  static isValid(url) {
    const now = new Date();

    // Check if blocked
    if (url.isBlocked) {
      return { valid: false, reason: 'This URL has been blocked due to reports of malicious content.', status: 'blocked' };
    }

    // Check if not yet activated
    if (url.activateAt) {
      const activationDate = new Date(url.activateAt);
      if (activationDate > now) {
        return { valid: false, reason: 'This short URL is not yet active.', status: 'scheduled' };
      }
    }

    // Check if deactivated or expired (both mean the link is permanently done)
    if (url.deactivateAt) {
      const deactivationDate = new Date(url.deactivateAt);
      if (deactivationDate < now) {
        return { valid: false, reason: 'This short URL has expired.', status: 'expired' };
      }
    }

    if (url.expiresAt) {
      const expirationDate = new Date(url.expiresAt);
      if (expirationDate < now) {
        return { valid: false, reason: 'This short URL has expired.', status: 'expired' };
      }
    }

    // Check max uses
    if (url.maxUses !== null && url.clicks >= url.maxUses) {
      return { valid: false, reason: 'This short URL has reached its maximum number of uses.', status: 'max_uses' };
    }

    return { valid: true, reason: null, status: 'active' };
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