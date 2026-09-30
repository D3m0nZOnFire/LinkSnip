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
 * Middleware to attach user to request object and update last active.
 * The session is set at login; this re-checks it against the database on every
 * request: a deleted or banned user is logged out (other session data such as
 * unlocks is kept), and session.isAdmin follows the current isAdmin flag.
 */
function attachUser(req, res, next) {
  if (req.session && req.session.userId) {
    const User = require('../models/User');
    const user = User.findById(req.session.userId);

    if (!user || user.isBanned) {
      delete req.session.userId;
      delete req.session.isAdmin;
      req.user = null;
      return next();
    }

    req.user = user;
    req.session.isAdmin = !!user.isAdmin;

    // Update last active timestamp
    db.prepare('UPDATE users SET lastActive = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
  }
  next();
}

module.exports = {
  isAuthenticated,
  isAdmin,
  attachUser
};