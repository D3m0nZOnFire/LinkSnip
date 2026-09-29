const express = require('express');
const router = express.Router();
const QRCodeController = require('../controllers/qrcodeController');
const { isAuthenticated } = require('../middleware/auth');

// QR Code routes (authenticated users only, or anonymous URLs)
router.get('/qrcode/:id', QRCodeController.generateQRCode);
router.get('/qrcode/:id/download', QRCodeController.downloadQRCode);
router.get('/api/qrcode/:id/dataurl', QRCodeController.getQRCodeDataURL);

module.exports = router;
