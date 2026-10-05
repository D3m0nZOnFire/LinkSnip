const db = require('../config/database');
const { CONTENT_TYPES, contentType } = require('../services/contentTypes');

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
   * Create a new tag (or return the existing one with that name)
   * @param {string} name - Tag name
   * @param {number} userId - User ID (null for system-wide tags)
   * @param {string} color - Optional color (auto-assigned if not provided)
   * @param {number} teamId - A team's tag instead of a user's (userId is then ignored)
   * @returns {object} Created tag
   */
  static create(name, userId = null, color = null, teamId = null) {
    // Normalize tag name (lowercase, trim)
    const normalizedName = name.trim().toLowerCase();
    if (teamId !== null) userId = null;

    // Check if tag already exists for this user or team
    const existing = teamId !== null ? this.findByTeamName(normalizedName, teamId) : this.findByName(normalizedName, userId);
    if (existing) {
      return existing;
    }

    // Auto-assign color if not provided
    if (!color) {
      const existingTags = teamId !== null ? this.forTeam(teamId) : (userId ? this.findByUserId(userId) : this.findAll());
      color = TAG_COLORS[existingTags.length % TAG_COLORS.length];
    }

    const stmt = db.prepare(`
      INSERT INTO tags (name, userId, color, teamId)
      VALUES (?, ?, ?, ?)
    `);

    const result = stmt.run(normalizedName, userId, color, teamId);
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
    const stmt = db.prepare('SELECT * FROM tags WHERE name = ? AND userId IS ? AND teamId IS NULL');
    return stmt.get(normalizedName, userId);
  }

  /** A team's tag by name */
  static findByTeamName(name, teamId) {
    return db.prepare('SELECT * FROM tags WHERE name = ? AND teamId = ?').get(name.trim().toLowerCase(), teamId);
  }

  /** A team's tags, by name */
  static forTeam(teamId) {
    return db.prepare('SELECT * FROM tags WHERE teamId = ? ORDER BY name ASC').all(teamId);
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
      WHERE userId IS NULL AND teamId IS NULL
      ORDER BY name ASC
    `);
    return stmt.all();
  }

  /**
   * Tags on one item of any content type, by name
   * @param {'url'|'bundle'|'paste'|'file'} type
   * @param {number} id
   * @returns {array}
   */
  static forItem(type, id) {
    contentType(type);
    return db.prepare(`
      SELECT t.* FROM tags t
      INNER JOIN taggables tg ON tg.tagId = t.id
      WHERE tg.targetType = ? AND tg.targetId = ?
      ORDER BY t.name ASC
    `).all(type, id);
  }

  /**
   * Replace an item's tags (an empty list removes them all). Tags belong to the
   * item's owner, whoever edits it, or to its team for a team item; an item without
   * an owner gets none.
   * @param {'url'|'bundle'|'paste'|'file'} type
   * @param {number} id
   * @param {array} tagNames
   */
  static setForItem(type, id, tagNames) {
    const { table, ownerColumn } = contentType(type);
    const item = db.prepare(`SELECT ${ownerColumn} AS ownerId, teamId FROM ${table} WHERE id = ?`).get(id);
    const ownerId = item ? item.ownerId : null;
    const teamId = item && item.teamId != null ? item.teamId : null;
    const names = ownerId == null && teamId == null ? [] : [...new Set((tagNames || [])
      .map(name => String(name).trim().toLowerCase())
      .filter(Boolean))];

    db.transaction(() => {
      db.prepare('DELETE FROM taggables WHERE targetType = ? AND targetId = ?').run(type, id);
      const insert = db.prepare('INSERT OR IGNORE INTO taggables (tagId, targetType, targetId) VALUES (?, ?, ?)');
      for (const name of names) insert.run(this.create(name, ownerId, null, teamId).id, type, id);
    })();
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
   * All of a user's tags, each with its tagged items per type (`counts`), their
   * total (`itemCount`) and their visits (analytics events, bundle item clicks
   * left out). Only the given types count (leave out switched-off features).
   * @param {number} userId
   * @param {array} types
   * @returns {array}
   */
  static getAllWithStats(userId, types = Object.keys(CONTENT_TYPES)) {
    const tags = this.findByUserId(userId);
    if (!types.length) return tags.map(tag => ({ ...tag, counts: {}, itemCount: 0, visits: 0 }));

    const rows = db.prepare(`
      SELECT tg.tagId, tg.targetType,
             COUNT(*) AS items,
             SUM((SELECT COUNT(*) FROM analytics_events e
                  WHERE e.targetType = tg.targetType AND e.targetId = tg.targetId AND e.subTargetId IS NULL)) AS visits
      FROM taggables tg
      INNER JOIN tags t ON t.id = tg.tagId
      WHERE t.userId = ? AND tg.targetType IN (${types.map(() => '?').join(',')})
      GROUP BY tg.tagId, tg.targetType
    `).all(userId, ...types);

    return tags.map(tag => {
      const counts = Object.fromEntries(types.map(type => [type, 0]));
      let visits = 0;
      for (const row of rows.filter(r => r.tagId === tag.id)) {
        counts[row.targetType] = row.items;
        visits += row.visits;
      }
      const itemCount = Object.values(counts).reduce((sum, n) => sum + n, 0);
      return { ...tag, counts, itemCount, visits };
    });
  }

  /**
   * The given tags, each with `itemCount`: how many items of the given types carry it (the dashboard's tag filter).
   * @param {array} tags
   * @param {array} types
   * @returns {array}
   */
  static withItemCounts(tags, types = Object.keys(CONTENT_TYPES)) {
    if (!tags.length || !types.length) return tags.map(tag => ({ ...tag, itemCount: 0 }));
    const counts = new Map(db.prepare(`
      SELECT tagId, COUNT(*) AS n FROM taggables
      WHERE tagId IN (${tags.map(() => '?').join(',')}) AND targetType IN (${types.map(() => '?').join(',')})
      GROUP BY tagId
    `).all(...tags.map(tag => tag.id), ...types).map(row => [row.tagId, row.n]));
    return tags.map(tag => ({ ...tag, itemCount: counts.get(tag.id) || 0 }));
  }

  /**
   * The items carrying a tag, newest first: { type, id, slug, name, visits, createdAt }
   * (`name` is the type's destination: the long URL, title or file name).
   * @param {number} tagId
   * @param {array} types
   * @returns {array}
   */
  static itemsFor(tagId, types = Object.keys(CONTENT_TYPES)) {
    if (!types.length) return [];
    const selects = types.map(type => {
      const { table, destination } = contentType(type);
      return `
        SELECT '${type}' AS type, x.id AS id, x.slug AS slug, x.${destination} AS name, x.createdAt AS createdAt,
               (SELECT COUNT(*) FROM analytics_events e
                WHERE e.targetType = '${type}' AND e.targetId = x.id AND e.subTargetId IS NULL) AS visits
        FROM ${table} x
        INNER JOIN taggables tg ON tg.targetType = '${type}' AND tg.targetId = x.id
        WHERE tg.tagId = @tagId`;
    });
    return db.prepare(`
      SELECT * FROM (${selects.join('\n        UNION ALL')})
      ORDER BY createdAt DESC, type ASC, id DESC
    `).all({ tagId });
  }

  /**
   * Visits per day summed over every item carrying a tag, the last `days` days
   * (days without visits left out).
   * @param {number} tagId
   * @param {array} types
   * @param {number} days
   * @returns {Array<{ date, count }>}
   */
  static dailyVisits(tagId, types = Object.keys(CONTENT_TYPES), days = 30) {
    if (!types.length) return [];
    return db.prepare(`
      SELECT DATE(e.timestamp) AS date, COUNT(*) AS count
      FROM analytics_events e
      INNER JOIN taggables tg ON tg.targetType = e.targetType AND tg.targetId = e.targetId
      WHERE tg.tagId = ? AND e.subTargetId IS NULL AND e.targetType IN (${types.map(() => '?').join(',')})
        AND e.timestamp >= datetime('now', '-' || ? || ' days')
      GROUP BY DATE(e.timestamp) ORDER BY date ASC
    `).all(tagId, ...types, days);
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
