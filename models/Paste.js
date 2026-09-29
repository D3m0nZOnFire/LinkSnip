const db = require('../config/database');

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
    if (paste) paste.tags = this.getTags(paste.id);
    return paste;
  }

  static findBySlug(slug) {
    const paste = db.prepare('SELECT * FROM pastes WHERE slug = ?').get(slug);
    if (paste) paste.tags = this.getTags(paste.id);
    return paste;
  }

  static findByUserId(userId, limit = null, offset = 0) {
    let query = `
      SELECT pastes.*, users.username AS ownerUsername
      FROM pastes
      LEFT JOIN users ON pastes.userId = users.id
      WHERE pastes.userId = ?
      ORDER BY pastes.createdAt DESC
    `;
    const params = [userId];
    if (limit !== null) {
      query += ' LIMIT ? OFFSET ?';
      params.push(limit, offset);
    }
    const rows = db.prepare(query).all(...params);
    return rows.map(p => ({ ...p, tags: this.getTags(p.id) }));
  }

  static countByUserId(userId) {
    const result = db.prepare('SELECT COUNT(*) as count FROM pastes WHERE userId = ?').get(userId);
    return result ? result.count : 0;
  }

  static findAll(limit = null, offset = 0, search = '') {
    let query = `
      SELECT pastes.*, users.username AS ownerUsername
      FROM pastes
      LEFT JOIN users ON pastes.userId = users.id
    `;
    const params = [];
    if (search) {
      query += ' WHERE pastes.title LIKE ?';
      params.push(`%${search}%`);
    }
    query += ' ORDER BY pastes.createdAt DESC';
    if (limit !== null) {
      query += ' LIMIT ? OFFSET ?';
      params.push(limit, offset);
    }
    const rows = db.prepare(query).all(...params);
    return rows.map(p => ({ ...p, tags: this.getTags(p.id) }));
  }

  static countAll(search = '') {
    let query = 'SELECT COUNT(*) as count FROM pastes';
    const params = [];
    if (search) {
      query += ' WHERE title LIKE ?';
      params.push(`%${search}%`);
    }
    return db.prepare(query).get(...params).count;
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

  static update(id, { title, language, content, expiresAt, activateAt, deactivateAt, maxViews, password, tagIds }) {
    const current = this.findById(id);
    if (!current) return null;

    db.prepare(`
      UPDATE pastes
      SET title = ?, language = ?, content = ?, expiresAt = ?, activateAt = ?,
          deactivateAt = ?, maxViews = ?, password = ?
      WHERE id = ?
    `).run(
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

    if (tagIds !== undefined) {
      this.replaceTags(id, tagIds);
    }

    return this.findById(id);
  }

  static getTags(pasteId) {
    return db.prepare(`
      SELECT tags.* FROM tags
      INNER JOIN paste_tags ON tags.id = paste_tags.tagId
      WHERE paste_tags.pasteId = ?
      ORDER BY tags.name ASC
    `).all(pasteId);
  }

  static replaceTags(pasteId, tagIds) {
    const replaceTx = db.transaction((pid, ids) => {
      db.prepare('DELETE FROM paste_tags WHERE pasteId = ?').run(pid);
      if (ids && ids.length > 0) {
        const insert = db.prepare('INSERT OR IGNORE INTO paste_tags (pasteId, tagId) VALUES (?, ?)');
        for (const tagId of ids) {
          insert.run(pid, tagId);
        }
      }
    });
    replaceTx(pasteId, tagIds);
  }

  static slugExists(slug) {
    return !!db.prepare('SELECT id FROM pastes WHERE slug = ?').get(slug);
  }

  static generateUniqueSlug() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    for (let attempt = 0; attempt < 10; attempt++) {
      let slug = '';
      for (let i = 0; i < 5; i++) slug += chars[Math.floor(Math.random() * chars.length)];
      if (!this.slugExists(slug)) return slug;
    }
    throw new Error('Unable to generate unique paste slug after multiple attempts');
  }

  static isValid(paste) {
    const now = new Date();

    if (paste.isBlocked) {
      return { valid: false, reason: 'This paste has been blocked due to reports of malicious content.', status: 'blocked' };
    }
    if (paste.activateAt && new Date(paste.activateAt) > now) {
      return { valid: false, reason: 'This paste is not yet active.', status: 'scheduled' };
    }
    if (paste.deactivateAt && new Date(paste.deactivateAt) < now) {
      return { valid: false, reason: 'This paste has expired.', status: 'expired' };
    }
    if (paste.expiresAt && new Date(paste.expiresAt) < now) {
      return { valid: false, reason: 'This paste has expired.', status: 'expired' };
    }
    if (paste.maxViews !== null && paste.views >= paste.maxViews) {
      return { valid: false, reason: 'This paste has reached its maximum number of views.', status: 'max_views' };
    }

    return { valid: true, reason: null, status: 'active' };
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
