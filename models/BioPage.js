const db = require('../config/database');
const Tag = require('./Tag');

class BioPage {
  /**
   * Create a new bio page
   * @param {number} userId
   * @param {string} displayName
   * @param {string} bio - Optional bio text
   * @param {string} theme - 'dark', 'light', or 'gradient'
   * @param {string} gradientStart - Start color for gradient theme
   * @param {string} gradientEnd - End color for gradient theme
   * @returns {object} Created bio page
   */
  static create(userId, displayName, bio = null, theme = 'dark', gradientStart = '#667eea', gradientEnd = '#764ba2') {
    const stmt = db.prepare(`
      INSERT INTO bio_pages (userId, displayName, bio, theme, socialLinks, gradientStart, gradientEnd)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(userId, displayName, bio, theme, null, gradientStart, gradientEnd);
    return this.findById(result.lastInsertRowid);
  }

  /**
   * Find bio page by ID
   * @param {number} id
   * @returns {object|null}
   */
  static findById(id) {
    const stmt = db.prepare('SELECT * FROM bio_pages WHERE id = ?');
    const bioPage = stmt.get(id);

    if (bioPage) {
      // Parse socialLinks if it exists and is a string
      if (bioPage.socialLinks && typeof bioPage.socialLinks === 'string') {
        try {
          bioPage.socialLinks = JSON.parse(bioPage.socialLinks);
        } catch (e) {
          bioPage.socialLinks = [];
        }
      } else if (!bioPage.socialLinks) {
        bioPage.socialLinks = [];
      }
    }

    return bioPage;
  }

  /**
   * Find bio page by user ID
   * @param {number} userId
   * @returns {object|null}
   */
  static findByUserId(userId) {
    const stmt = db.prepare('SELECT * FROM bio_pages WHERE userId = ?');
    const bioPage = stmt.get(userId);

    if (bioPage) {
      // Parse socialLinks if it exists and is a string
      if (bioPage.socialLinks && typeof bioPage.socialLinks === 'string') {
        try {
          bioPage.socialLinks = JSON.parse(bioPage.socialLinks);
        } catch (e) {
          bioPage.socialLinks = [];
        }
      } else if (!bioPage.socialLinks) {
        bioPage.socialLinks = [];
      }
    }

    return bioPage;
  }

  /**
   * Find bio page by username
   * @param {string} username
   * @returns {object|null}
   */
  static findByUsername(username) {
    const stmt = db.prepare(`
      SELECT bp.* FROM bio_pages bp
      INNER JOIN users u ON bp.userId = u.id
      WHERE u.username = ?
    `);
    const bioPage = stmt.get(username);

    if (bioPage) {
      // Parse socialLinks if it exists and is a string
      if (bioPage.socialLinks && typeof bioPage.socialLinks === 'string') {
        try {
          bioPage.socialLinks = JSON.parse(bioPage.socialLinks);
        } catch (e) {
          bioPage.socialLinks = [];
        }
      } else if (!bioPage.socialLinks) {
        bioPage.socialLinks = [];
      }
    }

    return bioPage;
  }

  /**
   * Update bio page
   * @param {number} id
   * @param {object} data - { displayName, bio, theme, socialLinks, gradientStart, gradientEnd }
   * @returns {object} Updated bio page
   */
  static update(id, { displayName, bio, theme, socialLinks, gradientStart, gradientEnd }) {
    const updates = [];
    const values = [];

    if (displayName !== undefined) {
      updates.push('displayName = ?');
      values.push(displayName);
    }

    if (bio !== undefined) {
      updates.push('bio = ?');
      values.push(bio);
    }

    if (theme !== undefined) {
      updates.push('theme = ?');
      values.push(theme);
    }

    if (socialLinks !== undefined) {
      updates.push('socialLinks = ?');
      values.push(typeof socialLinks === 'string' ? socialLinks : JSON.stringify(socialLinks));
    }

    if (gradientStart !== undefined) {
      updates.push('gradientStart = ?');
      values.push(gradientStart);
    }

    if (gradientEnd !== undefined) {
      updates.push('gradientEnd = ?');
      values.push(gradientEnd);
    }

    if (updates.length > 0) {
      updates.push('updatedAt = CURRENT_TIMESTAMP');
      values.push(id);

      const stmt = db.prepare(`
        UPDATE bio_pages
        SET ${updates.join(', ')}
        WHERE id = ?
      `);

      stmt.run(...values);
    }

    return this.findById(id);
  }

  /**
   * Delete bio page
   * @param {number} id
   * @returns {boolean}
   */
  static delete(id) {
    const stmt = db.prepare('DELETE FROM bio_pages WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  /**
   * Get URLs attached to bio page (ordered by position)
   * @param {number} bioPageId
   * @returns {array} Array of URL objects with tags
   */
  static getUrls(bioPageId) {
    const stmt = db.prepare(`
      SELECT u.*, bpu.position
      FROM urls u
      INNER JOIN bio_page_urls bpu ON u.id = bpu.urlId
      WHERE bpu.bioPageId = ?
      ORDER BY bpu.position ASC, u.createdAt DESC
    `);

    const urls = stmt.all(bioPageId);

    // Attach tags to each URL (following existing pattern)
    return urls.map(url => ({
      ...url,
      tags: Tag.findByUrlId(url.id)
    }));
  }

  /**
   * Attach URL to bio page
   * @param {number} bioPageId
   * @param {number} urlId
   * @param {number} position - Optional position (auto-calculated if not provided)
   */
  static attachUrl(bioPageId, urlId, position = null) {
    // If position not provided, add at end
    if (position === null) {
      const maxPosStmt = db.prepare(`
        SELECT MAX(position) as maxPos FROM bio_page_urls WHERE bioPageId = ?
      `);
      const result = maxPosStmt.get(bioPageId);
      position = (result.maxPos !== null ? result.maxPos : -1) + 1;
    }

    const stmt = db.prepare(`
      INSERT INTO bio_page_urls (bioPageId, urlId, position)
      VALUES (?, ?, ?)
      ON CONFLICT(bioPageId, urlId) DO UPDATE SET position = excluded.position
    `);

    stmt.run(bioPageId, urlId, position);
  }

  /**
   * Detach URL from bio page
   * @param {number} bioPageId
   * @param {number} urlId
   */
  static detachUrl(bioPageId, urlId) {
    const stmt = db.prepare(`
      DELETE FROM bio_page_urls WHERE bioPageId = ? AND urlId = ?
    `);
    stmt.run(bioPageId, urlId);
  }

  /**
   * Update URL positions on bio page
   * @param {number} bioPageId
   * @param {array} urlPositions - Array of { urlId, position }
   */
  static updateUrlPositions(bioPageId, urlPositions) {
    const stmt = db.prepare(`
      UPDATE bio_page_urls
      SET position = ?
      WHERE bioPageId = ? AND urlId = ?
    `);

    for (const { urlId, position } of urlPositions) {
      stmt.run(position, bioPageId, urlId);
    }
  }

  /**
   * Check if URL is on bio page
   * @param {number} bioPageId
   * @param {number} urlId
   * @returns {boolean}
   */
  static hasUrl(bioPageId, urlId) {
    const stmt = db.prepare(`
      SELECT 1 FROM bio_page_urls WHERE bioPageId = ? AND urlId = ?
    `);
    return !!stmt.get(bioPageId, urlId);
  }
}

module.exports = BioPage;
