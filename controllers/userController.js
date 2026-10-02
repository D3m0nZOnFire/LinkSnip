const { deleteAccount } = require('../services/accountDeletion');
const { passwordProblem } = require('../services/passwordPolicy');
const User = require('../models/User');
const Url = require('../models/Url');
const bcrypt = require('bcrypt');
const db = require('../config/database');
const { logAccountChange, ACTIONS } = require('../services/auditService');

class UserController {
  /**
   * Render settings page
   * GET /settings
   */
  static getSettings(req, res) {
    res.render('settings', {
      user: req.user
    });
  }

  /**
   * Update username
   * PUT /api/user/username
   */
  static async updateUsername(req, res) {
    const { newUsername, currentPassword } = req.body;

    if (!newUsername || !currentPassword) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    try {
      // Get user with password
      const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
      const user = stmt.get(req.session.userId);

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Verify current password
      const isValidPassword = await bcrypt.compare(currentPassword, user.password);

      if (!isValidPassword) {
        return res.status(401).json({ error: 'Invalid password' });
      }

      // Update username
      const updateStmt = db.prepare('UPDATE users SET username = ? WHERE id = ?');

      try {
        const oldUsername = user.username;
        updateStmt.run(newUsername, req.session.userId);
        req.session.username = newUsername;

        // Log username change
        logAccountChange(ACTIONS.PROFILE_UPDATE, req, {
          field: 'username',
          oldValue: oldUsername,
          newValue: newUsername
        });

        res.json({ success: true, username: newUsername });
      } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT') {
          return res.status(400).json({ error: 'Username already exists' });
        }
        throw error;
      }
    } catch (error) {
      console.error('Update username error:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Update password
   * PUT /api/user/password
   */
  static async updatePassword(req, res) {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Both passwords are required' });
    }

    const weak = passwordProblem(newPassword);
    if (weak) {
      return res.status(400).json({ error: weak });
    }

    try {
      // Get user with password
      const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
      const user = stmt.get(req.session.userId);

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Verify current password
      const isValidPassword = await bcrypt.compare(currentPassword, user.password);

      if (!isValidPassword) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }

      // Hash new password
      const hashedPassword = await bcrypt.hash(newPassword, 10);

      // Update password
      const updateStmt = db.prepare('UPDATE users SET password = ? WHERE id = ?');
      updateStmt.run(hashedPassword, req.session.userId);

      // Log password change
      logAccountChange(ACTIONS.PASSWORD_CHANGE, req, {
        username: user.username
      });

      res.json({ success: true });
    } catch (error) {
      console.error('Update password error:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Delete account
   * DELETE /api/user/account
   */
  static async deleteAccount(req, res) {
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }

    try {
      // Get user with password
      const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
      const user = stmt.get(req.session.userId);

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Verify password
      const isValidPassword = await bcrypt.compare(password, user.password);

      if (!isValidPassword) {
        return res.status(401).json({ error: 'Invalid password' });
      }

      // The account and its personal items (team items stay with the team)
      deleteAccount(user.id);

      // Destroy session
      req.session.destroy();

      res.json({ success: true });
    } catch (error) {
      console.error('Delete account error:', error);
      res.status(500).json({ error: error.message });
    }
  }
}

module.exports = UserController;