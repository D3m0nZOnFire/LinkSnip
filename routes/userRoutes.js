const express = require('express');
const router = express.Router();
const UserController = require('../controllers/userController');
const { isAuthenticated } = require('../middleware/auth');
const User = require('../models/User');

// Settings page
router.get('/settings', isAuthenticated, UserController.getSettings);

// Username lookup (used by file sharing UI)
router.get('/api/users/lookup', isAuthenticated, (req, res) => {
  const username = (req.query.username || '').trim().toLowerCase();
  if (!username || username.length < 2) {
    return res.json({ found: false });
  }
  const user = User.findByUsername(username);
  if (!user || user.id === req.user.id) {
    return res.json({ found: false });
  }
  return res.json({ found: true, id: user.id, username: user.username });
});

// API routes
router.put('/api/user/username', isAuthenticated, UserController.updateUsername);
router.put('/api/user/password', isAuthenticated, UserController.updatePassword);
router.delete('/api/user/account', isAuthenticated, UserController.deleteAccount);

module.exports = router;