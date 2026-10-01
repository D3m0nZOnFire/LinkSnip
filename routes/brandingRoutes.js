const express = require('express');
const router = express.Router();
const BrandingController = require('../controllers/brandingController');

// Public files of Admin → Appearance. Mounted before sessions and the setup check: every page needs them.
router.get('/theme.css', BrandingController.themeCss);
router.get('/branding/:asset', BrandingController.asset);

module.exports = router;
