const express = require('express');
const router = express.Router();
const LegalController = require('../controllers/legalController');

// Readable by everyone, a private instance's visitors too (middleware/requireLogin.js)
router.get('/privacy', LegalController.privacyPage);
router.get('/terms', LegalController.termsPage);

module.exports = router;
