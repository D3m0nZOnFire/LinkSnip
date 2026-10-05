const db = require('../config/database');
const Tag = require('./Tag');
const { scopeCondition } = require('../services/itemScope');

class Paste {
  static create({ userId, slug, title, content, language, expiresAt, activateAt, deactivateAt, maxViews, password }) {
    const stmt = db.prepare(`
      INSERT INTO pastes
        (userId, slug, title, content, language, expiresAt, activateAt, deactivateAt, maxViews, password)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      userId || null,
      slug,
      title || null,
      content,
      language || null,
      expiresAt || null,
      activateAt || null,
      deactivateAt || null,
      maxViews || null,
      password || null
    );
    return this.findById(result.lastInsertRowid);
  }

  static findById(id) {
    const paste = db.prepare('SELECT * FROM pastes WHERE id = ?').get(id);
    if (paste) paste.tags = Tag.forItem('paste', paste.id);
    return paste;
  }

  static findBySlug(slug) {
    const paste = db.prepare('SELECT * FROM pastes WHERE slug = ? COLLATE NOCASE').get(slug);
    if (paste) paste.tags = Tag.forItem('paste', paste.id);
    return paste;
  }

  /** A user's personal pastes, or a team's ({ teamId }) */
  static findByUserId(userId, limit = null, offset = 0) {
    const scope = scopeCondition('paste', userId);
    let query = `
      SELECT pastes.*, users.username AS ownerUsername
      FROM pastes
      LEFT JOIN users ON pastes.userId = users.id
      WHERE ${scope.sql}
      ORDER BY pastes.createdAt DESC
    `;
    const params = [...scope.params];
    if (limit !== null) {
      query += ' LIMIT ? OFFSET ?';
      params.push(limit, offset);
    }
    const rows = db.prepare(query).all(...params);
    return rows.map(p => ({ ...p, tags: Tag.forItem('paste', p.id) }));
  }

  static countByUserId(userId) {
    const result = db.prepare('SELECT COUNT(*) as count FROM pastes WHERE userId = ?').get(userId);
    return result ? result.count : 0;
  }

  static findExpired() {
    const now = new Date().toISOString();
    return db.prepare(`
      SELECT * FROM pastes
      WHERE (expiresAt IS NOT NULL AND expiresAt < ?)
         OR (deactivateAt IS NOT NULL AND deactivateAt < ?)
    `).all(now, now);
  }

  static delete(id) {
    return db.prepare('DELETE FROM pastes WHERE id = ?').run(id);
  }

  static incrementViews(id) {
    return db.prepare('UPDATE pastes SET views = views + 1 WHERE id = ?').run(id);
  }

  static update(id, { slug, title, language, content, expiresAt, activateAt, deactivateAt, maxViews, password }) {
    const current = this.findById(id);
    if (!current) return null;

    db.prepare(`
      UPDATE pastes
      SET slug = ?, title = ?, language = ?, content = ?, expiresAt = ?, activateAt = ?,
          deactivateAt = ?, maxViews = ?, password = ?
      WHERE id = ?
    `).run(
      slug !== undefined ? slug : current.slug,
      title !== undefined ? (title || null) : current.title,
      language !== undefined ? (language || null) : current.language,
      content !== undefined ? content : current.content,
      expiresAt !== undefined ? (expiresAt || null) : current.expiresAt,
      activateAt !== undefined ? (activateAt || null) : current.activateAt,
      deactivateAt !== undefined ? (deactivateAt || null) : current.deactivateAt,
      maxViews !== undefined ? (maxViews || null) : current.maxViews,
      password !== undefined ? password : current.password,
      id
    );

    return this.findById(id);
  }

  static block(id) {
    const result = db.prepare('UPDATE pastes SET isBlocked = 1 WHERE id = ?').run(id);
    return result.changes > 0;
  }

  static unblock(id) {
    const result = db.prepare('UPDATE pastes SET isBlocked = 0 WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /**
   * Delete inactive anonymous pastes (expired or past deactivateAt) immediately
   * @returns {number} Number of pastes deleted
   */
  static deleteInactiveAnonymous() {
    const stmt = db.prepare(`
      DELETE FROM pastes
      WHERE userId IS NULL
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
   * Delete inactive registered-user pastes past the grace period
   * @param {number} graceDays - Days after becoming inactive before deletion
   * @returns {number} Number of pastes deleted
   */
  static deleteInactiveRegistered(graceDays = 90) {
    const stmt = db.prepare(`
      DELETE FROM pastes
      WHERE userId IS NOT NULL
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

module.exports = Paste;
