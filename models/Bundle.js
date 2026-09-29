const db = require('../config/database');

class Bundle {
  /**
   * Create a new bundle
   */
  static create({ slug, title, description, creatorId, maxUses, expiresAt, password, activateAt, deactivateAt }) {
    const stmt = db.prepare(`
      INSERT INTO bundles (slug, title, description, creatorId, maxUses, expiresAt, password, activateAt, deactivateAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      slug,
      title,
      description || null,
      creatorId || null,
      maxUses || null,
      expiresAt || null,
      password || null,
      activateAt || null,
      deactivateAt || null
    );

    return this.findById(result.lastInsertRowid);
  }

  /**
   * Replace all items for a bundle (used for create and update)
   * Runs in a transaction: delete existing items, then insert new ones.
   */
  static replaceItems(bundleId, items) {
    const replaceTransaction = db.transaction((bId, itemList) => {
      db.prepare('DELETE FROM bundle_items WHERE bundleId = ?').run(bId);
      const insert = db.prepare('INSERT INTO bundle_items (bundleId, url, label, position) VALUES (?, ?, ?, ?)');
      itemList.forEach((item, index) => {
        insert.run(bId, item.url, item.label || null, index);
      });
    });
    replaceTransaction(bundleId, items);
  }

  /**
   * Find bundle by slug
   */
  static findBySlug(slug) {
    return db.prepare('SELECT * FROM bundles WHERE slug = ?').get(slug);
  }

  /**
   * Find bundle by ID
   */
  static findById(id) {
    return db.prepare('SELECT * FROM bundles WHERE id = ?').get(id);
  }

  /**
   * Find bundle by ID with its items
   */
  static findByIdWithItems(id) {
    const bundle = this.findById(id);
    if (!bundle) return null;
    bundle.items = this.getItems(id);
    return bundle;
  }

  /**
   * Get all items for a bundle, ordered by position
   */
  static getItems(bundleId) {
    return db.prepare('SELECT * FROM bundle_items WHERE bundleId = ? ORDER BY position ASC, id ASC').all(bundleId);
  }

  /**
   * Find bundles by creator ID with item count, paginated
   */
  static findByCreatorId(creatorId, limit = null, offset = 0) {
    let query = `
      SELECT bundles.*,
        (SELECT COUNT(*) FROM bundle_items WHERE bundleId = bundles.id) AS itemCount
      FROM bundles
      WHERE creatorId = ?
      ORDER BY createdAt DESC
    `;

    const params = [creatorId];

    if (limit !== null) {
      query += ' LIMIT ? OFFSET ?';
      params.push(limit, offset);
    }

    return db.prepare(query).all(...params);
  }

  /**
   * Count total bundles for a creator
   */
  static countByCreatorId(creatorId) {
    const result = db.prepare('SELECT COUNT(*) as count FROM bundles WHERE creatorId = ?').get(creatorId);
    return result ? result.count : 0;
  }

  /**
   * Update bundle metadata (not items)
   */
  static update(id, { title, description, maxUses, expiresAt, password, activateAt, deactivateAt }) {
    const stmt = db.prepare(`
      UPDATE bundles
      SET title = ?, description = ?, maxUses = ?, expiresAt = ?, password = ?, activateAt = ?, deactivateAt = ?
      WHERE id = ?
    `);
    stmt.run(
      title,
      description || null,
      maxUses || null,
      expiresAt || null,
      password !== undefined ? password : null,
      activateAt || null,
      deactivateAt || null,
      id
    );
    return this.findById(id);
  }

  /**
   * Delete a bundle (CASCADE removes bundle_items)
   */
  static delete(id) {
    return db.prepare('DELETE FROM bundles WHERE id = ?').run(id);
  }

  /**
   * Check if a slug exists in the bundles table
   */
  static slugExists(slug) {
    const result = db.prepare('SELECT id FROM bundles WHERE slug = ?').get(slug);
    return !!result;
  }

  /**
   * Generate a unique 5-character slug for a bundle
   */
  static generateUniqueSlug() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    for (let attempt = 0; attempt < 10; attempt++) {
      let slug = '';
      for (let i = 0; i < 5; i++) {
        slug += chars[Math.floor(Math.random() * chars.length)];
      }
      if (!this.slugExists(slug)) return slug;
    }
    throw new Error('Unable to generate unique bundle slug after multiple attempts');
  }

  /**
   * Validate and return a slug (custom or auto-generated)
   */
  static getValidSlug(customSlug) {
    if (customSlug) {
      if (!/^[A-Za-z0-9_-]{1,20}$/.test(customSlug)) {
        throw new Error('Custom slug must be 1-20 characters (A-Z, a-z, 0-9, -, _)');
      }
      if (this.slugExists(customSlug)) {
        throw new Error('Custom slug already exists. Please choose another.');
      }
      return customSlug;
    }
    return this.generateUniqueSlug();
  }

  /**
   * Increment click counter atomically
   */
  static incrementClicks(slug) {
    return db.prepare('UPDATE bundles SET clicks = clicks + 1 WHERE slug = ?').run(slug);
  }

  /**
   * Block a bundle
   */
  static block(id) {
    return db.prepare('UPDATE bundles SET isBlocked = 1 WHERE id = ?').run(id);
  }

  /**
   * Unblock a bundle
   */
  static unblock(id) {
    return db.prepare('UPDATE bundles SET isBlocked = 0 WHERE id = ?').run(id);
  }

  /**
   * Find all bundles system-wide with creator username and item count (admin use)
   */
  static findAll(limit = null, offset = 0) {
    let query = `
      SELECT bundles.*,
        users.username AS creatorUsername,
        (SELECT COUNT(*) FROM bundle_items WHERE bundleId = bundles.id) AS itemCount
      FROM bundles
      LEFT JOIN users ON bundles.creatorId = users.id
      ORDER BY bundles.createdAt DESC, bundles.id DESC
    `;
    const params = [];
    if (limit !== null) {
      query += ' LIMIT ? OFFSET ?';
      params.push(limit, offset);
    }
    return db.prepare(query).all(...params);
  }

  /**
   * Count all bundles system-wide (admin use)
   */
  static countAll() {
    const result = db.prepare('SELECT COUNT(*) as count FROM bundles').get();
    return result ? result.count : 0;
  }

  /**
   * Delete expired/deactivated anonymous bundles (no creatorId)
   */
  static deleteInactiveAnonymous() {
    const now = new Date().toISOString();
    const result = db.prepare(`
      DELETE FROM bundles
      WHERE creatorId IS NULL
        AND (
          (expiresAt IS NOT NULL AND expiresAt < ?)
          OR (deactivateAt IS NOT NULL AND deactivateAt < ?)
        )
    `).run(now, now);
    return result.changes;
  }
}

module.exports = Bundle;
