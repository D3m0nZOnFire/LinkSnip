const express = require('express');
const router = express.Router();
const InfoController = require('../controllers/infoController');

// Public URL info/preview page
router.get('/info/:slug', InfoController.getUrlInfo);

module.exports = router;
