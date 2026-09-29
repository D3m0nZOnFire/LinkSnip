const db = require('../config/database');

// Predefined color palette for tags
const TAG_COLORS = [
  '#34d399', '#10b981', '#059669', '#047857', // Greens
  '#60a5fa', '#3b82f6', '#2563eb', '#1d4ed8', // Blues
  '#f472b6', '#ec4899', '#db2777', '#be185d', // Pinks
  '#fb923c', '#f97316', '#ea580c', '#c2410c', // Oranges
  '#a78bfa', '#8b5cf6', '#7c3aed', '#6d28d9', // Purples
  '#fbbf24', '#f59e0b', '#d97706', '#b45309'  // Yellows
];

class Tag {
  /**
   * Create a new tag
   * @param {string} name - Tag name
   * @param {number} userId - User ID (null for system-wide tags)
   * @param {string} color - Optional color (auto-assigned if not provided)
   * @returns {object} Created tag
   */
  static create(name, userId = null, color = null) {
    // Normalize tag name (lowercase, trim)
    const normalizedName = name.trim().toLowerCase();

    // Check if tag already exists for this user
    const existing = this.findByName(normalizedName, userId);
    if (existing) {
      return existing;
    }

    // Auto-assign color if not provided
    if (!color) {
      const existingTags = userId ? this.findByUserId(userId) : this.findAll();
      color = TAG_COLORS[existingTags.length % TAG_COLORS.length];
    }

    const stmt = db.prepare(`
      INSERT INTO tags (name, userId, color)
      VALUES (?, ?, ?)
    `);

    const result = stmt.run(normalizedName, userId, color);
    return this.findById(result.lastInsertRowid);
  }

  /**
   * Find tag by ID
   * @param {number} id
   * @returns {object|null}
   */
  static findById(id) {
    const stmt = db.prepare('SELECT * FROM tags WHERE id = ?');
    return stmt.get(id);
  }

  /**
   * Find tag by name and user
   * @param {string} name
   * @param {number} userId
   * @returns {object|null}
   */
  static findByName(name, userId = null) {
    const normalizedName = name.trim().toLowerCase();
    const stmt = db.prepare('SELECT * FROM tags WHERE name = ? AND userId IS ?');
    return stmt.get(normalizedName, userId);
  }

  /**
   * Find all tags for a user
   * @param {number} userId
   * @returns {array}
   */
  static findByUserId(userId) {
    const stmt = db.prepare(`
      SELECT * FROM tags
      WHERE userId = ?
      ORDER BY name ASC
    `);
    return stmt.all(userId);
  }

  /**
   * Find all system-wide tags (userId is null)
   * @returns {array}
   */
  static findAll() {
    const stmt = db.prepare(`
      SELECT * FROM tags
      WHERE userId IS NULL
      ORDER BY name ASC
    `);
    return stmt.all();
  }

  /**
   * Get tags for a specific URL
   * @param {number} urlId
   * @returns {array}
   */
  static findByUrlId(urlId) {
    const stmt = db.prepare(`
      SELECT t.* FROM tags t
      INNER JOIN url_tags ut ON t.id = ut.tagId
      WHERE ut.urlId = ?
      ORDER BY t.name ASC
    `);
    return stmt.all(urlId);
  }

  /**
   * Attach tags to a URL
   * @param {number} urlId
   * @param {array} tagNames - Array of tag names
   * @param {number} userId
   */
  static attachToUrl(urlId, tagNames, userId = null) {
    if (!Array.isArray(tagNames) || tagNames.length === 0) {
      return;
    }

    // First, remove existing tags
    this.detachFromUrl(urlId);

    // Create tags if they don't exist and attach them
    const stmt = db.prepare(`
      INSERT INTO url_tags (urlId, tagId)
      VALUES (?, ?)
    `);

    for (const tagName of tagNames) {
      if (!tagName || !tagName.trim()) continue;

      // Create or get existing tag
      const tag = this.create(tagName, userId);

      // Attach to URL
      try {
        stmt.run(urlId, tag.id);
      } catch (error) {
        // Ignore if already attached
        if (!error.message.includes('UNIQUE')) {
          throw error;
        }
      }
    }
  }

  /**
   * Remove all tags from a URL
   * @param {number} urlId
   */
  static detachFromUrl(urlId) {
    const stmt = db.prepare('DELETE FROM url_tags WHERE urlId = ?');
    stmt.run(urlId);
  }

  /**
   * Attach tags to a file (creates tags if they don't exist)
   * @param {number} fileId
   * @param {array} tagNames - Array of tag names
   * @param {number} userId
   */
  static attachToFile(fileId, tagNames, userId = null) {
    if (!Array.isArray(tagNames) || tagNames.length === 0) {
      db.prepare('DELETE FROM file_tags WHERE fileId = ?').run(fileId);
      return;
    }

    db.prepare('DELETE FROM file_tags WHERE fileId = ?').run(fileId);

    const stmt = db.prepare('INSERT OR IGNORE INTO file_tags (fileId, tagId) VALUES (?, ?)');
    for (const tagName of tagNames) {
      if (!tagName || !tagName.trim()) continue;
      const tag = this.create(tagName, userId);
      stmt.run(fileId, tag.id);
    }
  }

  /**
   * Attach tags to a paste (creates tags if they don't exist)
   * @param {number} pasteId
   * @param {array} tagNames - Array of tag names
   * @param {number} userId
   */
  static attachToPaste(pasteId, tagNames, userId = null) {
    if (!Array.isArray(tagNames) || tagNames.length === 0) {
      db.prepare('DELETE FROM paste_tags WHERE pasteId = ?').run(pasteId);
      return;
    }

    db.prepare('DELETE FROM paste_tags WHERE pasteId = ?').run(pasteId);

    const stmt = db.prepare('INSERT OR IGNORE INTO paste_tags (pasteId, tagId) VALUES (?, ?)');
    for (const tagName of tagNames) {
      if (!tagName || !tagName.trim()) continue;
      const tag = this.create(tagName, userId);
      stmt.run(pasteId, tag.id);
    }
  }

  /**
   * Update tag
   * @param {number} id
   * @param {object} data - { name, color }
   * @returns {object} Updated tag
   */
  static update(id, { name, color }) {
    const updates = [];
    const values = [];

    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name.trim().toLowerCase());
    }

    if (color !== undefined) {
      updates.push('color = ?');
      values.push(color);
    }

    if (updates.length === 0) {
      return this.findById(id);
    }

    values.push(id);

    const stmt = db.prepare(`
      UPDATE tags
      SET ${updates.join(', ')}
      WHERE id = ?
    `);

    stmt.run(...values);
    return this.findById(id);
  }

  /**
   * Delete tag
   * @param {number} id
   * @returns {boolean}
   */
  static delete(id) {
    const stmt = db.prepare('DELETE FROM tags WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  /**
   * Get tag statistics
   * @param {number} tagId
   * @returns {object}
   */
  static getStats(tagId) {
    const stmt = db.prepare(`
      SELECT
        COUNT(DISTINCT ut.urlId) as urlCount,
        SUM(u.clicks) as totalClicks
      FROM url_tags ut
      LEFT JOIN urls u ON ut.urlId = u.id
      WHERE ut.tagId = ?
    `);

    return stmt.get(tagId) || { urlCount: 0, totalClicks: 0 };
  }

  /**
   * Get all tags with their statistics for a user
   * @param {number} userId
   * @returns {array}
   */
  static getAllWithStats(userId) {
    const stmt = db.prepare(`
      SELECT
        t.*,
        COUNT(DISTINCT ut.urlId) as urlCount,
        COALESCE(SUM(u.clicks), 0) as totalClicks
      FROM tags t
      LEFT JOIN url_tags ut ON t.id = ut.tagId
      LEFT JOIN urls u ON ut.urlId = u.id
      WHERE t.userId = ?
      GROUP BY t.id
      ORDER BY t.name ASC
    `);

    return stmt.all(userId);
  }

  /**
   * Parse tag string (comma-separated) into array
   * @param {string} tagString
   * @returns {array}
   */
  static parseTagString(tagString) {
    if (!tagString) return [];

    return tagString
      .split(',')
      .map(tag => tag.trim())
      .filter(tag => tag.length > 0 && tag.length <= 50); // Max 50 chars per tag
  }
}

module.exports = Tag;
