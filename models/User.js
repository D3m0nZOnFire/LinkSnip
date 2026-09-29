const db = require('../config/database');
const bcrypt = require('bcrypt');

class User {
  /**
   * Create a new user
   * @param {string} username
   * @param {string} password
   * @param {boolean} isAdmin
   * @returns {object} Created user (without password)
   */
  static async create(username, password, isAdmin = false, email = null) {
    // Hash password with salt rounds of 10
    const hashedPassword = await bcrypt.hash(password, 10);

    try {
      const stmt = db.prepare(`
        INSERT INTO users (username, email, password, isAdmin)
        VALUES (?, ?, ?, ?)
      `);

      const result = stmt.run(username, email, hashedPassword, isAdmin ? 1 : 0);

      return {
        id: result.lastInsertRowid,
        username,
        email,
        isAdmin
      };
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT' || error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw new Error('Username or email already exists');
      }
      throw error;
    }
  }

  /**
   * Find user by username
   * @param {string} username 
   * @returns {object|null} User object with password hash
   */
  static findByUsername(username) {
    const stmt = db.prepare('SELECT * FROM users WHERE username = ?');
    return stmt.get(username);
  }

  /**
   * Find user by email
   * @param {string} email
   * @returns {object|null} User object with password hash
   */
  static findByEmail(email) {
    const stmt = db.prepare('SELECT * FROM users WHERE email = ?');
    return stmt.get(email);
  }

  /**
   * Find user by ID
   * @param {number} id
   * @returns {object|null} User object without password
   */
  static findById(id) {
    const stmt = db.prepare('SELECT id, username, email, isAdmin, role, isBanned, createdAt, lastActive FROM users WHERE id = ?');
    return stmt.get(id);
  }

  /**
   * Verify password
   * @param {string} plainPassword
   * @param {string} hashedPassword
   * @returns {Promise<boolean>}
   */
  static async verifyPassword(plainPassword, hashedPassword) {
    return await bcrypt.compare(plainPassword, hashedPassword);
  }

  /**
   * Update user role (admin only)
   * @param {number} userId
   * @param {string|null} role - A role from roles.json, or null for the default role
   * @returns {object|undefined} Updated user
   */
  static updateRole(userId, role) {
    const stmt = db.prepare('UPDATE users SET role = ? WHERE id = ?');
    stmt.run(role, userId);
    return this.findById(userId);
  }

  /**
   * Get all users with pagination
   * @param {number} limit
   * @param {number} offset
   * @returns {array}
   */
  static findAll(limit = 50, offset = 0) {
    const stmt = db.prepare(`
      SELECT id, username, email, isAdmin, role, isBanned, createdAt, lastActive
      FROM users
      ORDER BY createdAt DESC
      LIMIT ? OFFSET ?
    `);
    return stmt.all(limit, offset);
  }

  /**
   * Count all users
   * @returns {number}
   */
  static count() {
    const stmt = db.prepare('SELECT COUNT(*) as count FROM users');
    const result = stmt.get();
    return result ? result.count : 0;
  }
}

module.exports = User;