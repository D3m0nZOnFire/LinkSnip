const db = require('../config/database');
const Tag = require('./Tag');
const { scopeCondition } = require('../services/itemScope');

const withTags = (bundle) => bundle && { ...bundle, tags: Tag.forItem('bundle', bundle.id) };

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
   * Set a bundle's items (create and update), in the given order. An existing item with
   * the same URL keeps its ID, and so its click history; its label and position are
   * updated. Items no longer listed are deleted (their clicks with them).
   */
  static replaceItems(bundleId, items) {
    db.transaction(() => {
      const unused = db.prepare('SELECT id, url FROM bundle_items WHERE bundleId = ? ORDER BY position, id').all(bundleId);
      const update = db.prepare('UPDATE bundle_items SET label = ?, position = ? WHERE id = ?');
      const insert = db.prepare('INSERT INTO bundle_items (bundleId, url, label, position) VALUES (?, ?, ?, ?)');

      items.forEach((item, position) => {
        const match = unused.findIndex(existing => existing.url === item.url);
        if (match === -1) {
          insert.run(bundleId, item.url, item.label || null, position);
        } else {
          update.run(item.label || null, position, unused[match].id);
          unused.splice(match, 1);
        }
      });

      const remove = db.prepare('DELETE FROM bundle_items WHERE id = ?');
      for (const gone of unused) remove.run(gone.id);
    })();
  }

  /**
   * Find bundle by slug
   */
  static findBySlug(slug) {
    return withTags(db.prepare('SELECT * FROM bundles WHERE slug = ? COLLATE NOCASE').get(slug));
  }

  /**
   * Find bundle by ID
   */
  static findById(id) {
    return withTags(db.prepare('SELECT * FROM bundles WHERE id = ?').get(id));
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
   * A user's personal bundles, or a team's ({ teamId }), with item count, paginated
   */
  static findByCreatorId(creatorId, limit = null, offset = 0) {
    const scope = scopeCondition('bundle', creatorId);
    let query = `
      SELECT bundles.*, creator.username AS creatorUsername,
        (SELECT COUNT(*) FROM bundle_items WHERE bundleId = bundles.id) AS itemCount
      FROM bundles
      LEFT JOIN users creator ON creator.id = bundles.creatorId
      WHERE ${scope.sql}
      ORDER BY bundles.createdAt DESC
    `;

    const params = [...scope.params];

    if (limit !== null) {
      query += ' LIMIT ? OFFSET ?';
      params.push(limit, offset);
    }

    return db.prepare(query).all(...params).map(withTags);
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
  /**
   * Update the given fields only: a field that is left out (undefined) keeps its stored
   * value, null removes it.
   */
  static update(id, changes) {
    const columns = ['slug', 'title', 'description', 'maxUses', 'expiresAt', 'password', 'activateAt', 'deactivateAt']
      .filter(column => changes[column] !== undefined);
    if (columns.length) {
      db.prepare(`UPDATE bundles SET ${columns.map(c => `${c} = ?`).join(', ')} WHERE id = ?`)
        .run(...columns.map(c => changes[c]), id);
    }
    return this.findById(id);
  }

  /**
   * Delete a bundle (CASCADE removes bundle_items)
   */
  static delete(id) {
    return db.prepare('DELETE FROM bundles WHERE id = ?').run(id);
  }

  /**
   * Increment click counter atomically
   */
  static incrementClicks(slug) {
    return db.prepare('UPDATE bundles SET clicks = clicks + 1 WHERE slug = ? COLLATE NOCASE').run(slug);
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
