const db = require('../config/database');

class File {
  static create({ userId, slug, originalName, storedName, mimeType, size, expiresAt, activateAt, deactivateAt, maxDownloads, password, sharingMode, allowedUsers }) {
    const stmt = db.prepare(`
      INSERT INTO files
        (userId, slug, originalName, storedName, mimeType, size, expiresAt, activateAt, deactivateAt, maxDownloads, password, sharingMode, allowedUsers)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      userId,
      slug,
      originalName,
      storedName,
      mimeType,
      size,
      expiresAt || null,
      activateAt || null,
      deactivateAt || null,
      maxDownloads || null,
      password || null,
      sharingMode || 'public',
      JSON.stringify(allowedUsers || [])
    );
    return this.findById(result.lastInsertRowid);
  }

  static findById(id) {
    const file = db.prepare('SELECT * FROM files WHERE id = ?').get(id);
    if (file) file.tags = this.getTags(file.id);
    return file;
  }

  static findBySlug(slug) {
    const file = db.prepare('SELECT * FROM files WHERE slug = ?').get(slug);
    if (file) file.tags = this.getTags(file.id);
    return file;
  }

  static findByUserId(userId, limit = null, offset = 0) {
    let query = `
      SELECT files.*, users.username AS ownerUsername
      FROM files
      LEFT JOIN users ON files.userId = users.id
      WHERE files.userId = ?
      ORDER BY files.createdAt DESC
    `;
    const params = [userId];
    if (limit !== null) {
      query += ' LIMIT ? OFFSET ?';
      params.push(limit, offset);
    }
    const rows = db.prepare(query).all(...params);
    return rows.map(f => ({ ...f, tags: this.getTags(f.id) }));
  }

  /** Total bytes of all of a user's files (for the storage quota). */
  static totalSizeByUserId(userId) {
    return db.prepare('SELECT COALESCE(SUM(size), 0) AS total FROM files WHERE userId = ?').get(userId).total;
  }

  static block(id) {
    db.prepare('UPDATE files SET isBlocked = 1 WHERE id = ?').run(id);
  }

  static unblock(id) {
    db.prepare('UPDATE files SET isBlocked = 0 WHERE id = ?').run(id);
  }

  static countByUserId(userId) {
    const result = db.prepare('SELECT COUNT(*) as count FROM files WHERE userId = ?').get(userId);
    return result ? result.count : 0;
  }

  static findAll(limit = null, offset = 0, search = '') {
    let query = `
      SELECT files.*, users.username AS ownerUsername
      FROM files
      LEFT JOIN users ON files.userId = users.id
    `;
    const params = [];
    if (search) {
      query += ' WHERE files.originalName LIKE ?';
      params.push(`%${search}%`);
    }
    query += ' ORDER BY files.createdAt DESC';
    if (limit !== null) {
      query += ' LIMIT ? OFFSET ?';
      params.push(limit, offset);
    }
    const rows = db.prepare(query).all(...params);
    return rows.map(f => ({ ...f, tags: this.getTags(f.id) }));
  }

  static countAll(search = '') {
    let query = 'SELECT COUNT(*) as count FROM files';
    const params = [];
    if (search) {
      query += ' WHERE originalName LIKE ?';
      params.push(`%${search}%`);
    }
    return db.prepare(query).get(...params).count;
  }

  static findExpired() {
    const now = new Date().toISOString();
    return db.prepare(`
      SELECT * FROM files
      WHERE (expiresAt IS NOT NULL AND expiresAt < ?)
         OR (deactivateAt IS NOT NULL AND deactivateAt < ?)
    `).all(now, now);
  }

  static delete(id) {
    return db.prepare('DELETE FROM files WHERE id = ?').run(id);
  }

  static incrementDownloads(id) {
    return db.prepare('UPDATE files SET downloads = downloads + 1 WHERE id = ?').run(id);
  }

  static update(id, { expiresAt, activateAt, deactivateAt, maxDownloads, password, sharingMode, allowedUsers, tagIds }) {
    const current = this.findById(id);
    if (!current) return null;

    db.prepare(`
      UPDATE files
      SET expiresAt = ?, activateAt = ?, deactivateAt = ?, maxDownloads = ?,
          password = ?, sharingMode = ?, allowedUsers = ?
      WHERE id = ?
    `).run(
      expiresAt !== undefined ? (expiresAt || null) : current.expiresAt,
      activateAt !== undefined ? (activateAt || null) : current.activateAt,
      deactivateAt !== undefined ? (deactivateAt || null) : current.deactivateAt,
      maxDownloads !== undefined ? (maxDownloads || null) : current.maxDownloads,
      password !== undefined ? password : current.password,
      sharingMode !== undefined ? sharingMode : current.sharingMode,
      allowedUsers !== undefined ? JSON.stringify(allowedUsers) : current.allowedUsers,
      id
    );

    if (tagIds !== undefined) {
      this.replaceTags(id, tagIds);
    }

    return this.findById(id);
  }

  static getTags(fileId) {
    return db.prepare(`
      SELECT tags.* FROM tags
      INNER JOIN file_tags ON tags.id = file_tags.tagId
      WHERE file_tags.fileId = ?
      ORDER BY tags.name ASC
    `).all(fileId);
  }

  static replaceTags(fileId, tagIds) {
    const replaceTx = db.transaction((fid, ids) => {
      db.prepare('DELETE FROM file_tags WHERE fileId = ?').run(fid);
      if (ids && ids.length > 0) {
        const insert = db.prepare('INSERT OR IGNORE INTO file_tags (fileId, tagId) VALUES (?, ?)');
        for (const tagId of ids) {
          insert.run(fid, tagId);
        }
      }
    });
    replaceTx(fileId, tagIds);
  }

  static slugExists(slug) {
    return !!db.prepare('SELECT id FROM files WHERE slug = ?').get(slug);
  }

  static generateUniqueSlug() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    for (let attempt = 0; attempt < 10; attempt++) {
      let slug = '';
      for (let i = 0; i < 5; i++) slug += chars[Math.floor(Math.random() * chars.length)];
      if (!this.slugExists(slug)) return slug;
    }
    throw new Error('Unable to generate unique file slug after multiple attempts');
  }
}

module.exports = File;
