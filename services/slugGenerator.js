const db = require('../config/database');

// URL-safe characters: A-Z, a-z, 0-9, -, _
const CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const SLUG_LENGTH = 5;

class SlugGenerator {
  /**
   * Generate a random 5-character slug
   * @returns {string} Random slug
   */
  static generateRandomSlug() {
    let slug = '';
    for (let i = 0; i < SLUG_LENGTH; i++) {
      const randomIndex = Math.floor(Math.random() * CHARACTERS.length);
      slug += CHARACTERS[randomIndex];
    }
    return slug;
  }

  /**
   * Check if a slug already exists in the database
   * @param {string} slug 
   * @returns {boolean} True if slug exists
   */
  static slugExists(slug) {
    const stmt = db.prepare('SELECT id FROM urls WHERE slug = ?');
    const result = stmt.get(slug);
    return !!result;
  }

  /**
   * Generate a unique slug (retry up to 10 times)
   * @returns {string} Unique slug
   * @throws {Error} If unable to generate unique slug
   */
  static generateUniqueSlug() {
    const maxAttempts = 10;
    
    for (let i = 0; i < maxAttempts; i++) {
      const slug = this.generateRandomSlug();
      if (!this.slugExists(slug)) {
        return slug;
      }
    }
    
    throw new Error('Unable to generate unique slug after multiple attempts');
  }

  /**
   * Validate custom slug format
   * @param {string} slug 
   * @returns {boolean} True if valid
   */
  static isValidSlug(slug) {
    // Must be 1-20 characters, only URL-safe characters
    const slugRegex = /^[A-Za-z0-9_-]{1,20}$/;
    return slugRegex.test(slug);
  }

  /**
   * Validate and return slug (custom or auto-generated)
   * @param {string|null} customSlug 
   * @returns {object} { slug, isCustom }
   * @throws {Error} If custom slug is invalid or already exists
   */
  static getValidSlug(customSlug) {
    if (customSlug) {
      // Validate custom slug format
      if (!this.isValidSlug(customSlug)) {
        throw new Error('Custom slug must be 1-20 characters (A-Z, a-z, 0-9, -, _)');
      }

      // Check if custom slug already exists
      if (this.slugExists(customSlug)) {
        throw new Error('Custom slug already exists. Please choose another.');
      }

      return { slug: customSlug, isCustom: true };
    }

    // Generate unique auto slug
    return { slug: this.generateUniqueSlug(), isCustom: false };
  }
}

module.exports = SlugGenerator;