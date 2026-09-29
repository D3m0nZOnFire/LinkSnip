const db = require('../config/database');

/**
 * Middleware to check if user is authenticated
 */
function isAuthenticated(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  res.status(401).redirect('/login');
}

/**
 * Middleware to check if user is an admin
 */
function isAdmin(req, res, next) {
  if (req.session && req.session.userId && req.session.isAdmin) {
    return next();
  }
  // Redirect to home instead of showing error page
  res.redirect('/');
}

/**
 * Middleware to attach user to request object and update last active
 */
function attachUser(req, res, next) {
  if (req.session && req.session.userId) {
    const User = require('../models/User');
    req.user = User.findById(req.session.userId);

    // Update last active timestamp
    const stmt = db.prepare('UPDATE users SET lastActive = CURRENT_TIMESTAMP WHERE id = ?');
    stmt.run(req.session.userId);
  }
  next();
}

module.exports = {
  isAuthenticated,
  isAdmin,
  attachUser
};