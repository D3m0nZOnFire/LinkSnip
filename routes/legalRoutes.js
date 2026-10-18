const express = require('express');
const router = express.Router();
const LegalController = require('../controllers/legalController');

// Readable by everyone, a private instance's visitors too (middleware/requireLogin.js)
router.get('/privacy', LegalController.privacyPage);
router.get('/terms', LegalController.termsPage);
router.get('/abuse', (req, res) => res.redirect('/terms#abuse')); // a short link to hand out

module.exports = router;
