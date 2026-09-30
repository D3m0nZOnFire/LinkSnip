const express = require('express');
const router = express.Router();
const QRCodeController = require('../controllers/qrcodeController');

// QR codes for every type, by slug (the type's feature switch is checked inside).
// The old ID-based /qrcode/:id and /qrcode/bundle/:id are gone on purpose: counting IDs revealed every slug.
router.get('/qrcode/:type/:slug/download', QRCodeController.download);
router.get('/qrcode/:type/:slug', QRCodeController.image);
router.get('/api/qrcode/:type/:slug/dataurl', QRCodeController.dataUrl);

module.exports = router;
