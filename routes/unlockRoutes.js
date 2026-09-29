const express = require('express');
const router = express.Router();
const unlockController = require('../controllers/unlockController');
const { unlockLimiter } = require('../middleware/rateLimiter');

// Show password unlock page
router.get('/:slug', unlockController.showUnlockPage);

// Process password submission (with rate limiting)
router.post('/:slug', unlockLimiter, unlockController.unlockUrl);

module.exports = router;
