const express = require('express');
const router = express.Router();
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { fileUpload } = require('../middleware/fileUpload');
const fs = require('fs');
const { isAuthenticated, isAdmin } = require('../middleware/auth');
const requirePermission = require('../middleware/requirePermission');
const { uploadLimiter } = require('../middleware/rateLimiter');
const { UPLOADS_DIR } = require('../config/paths');
const fileController = require('../controllers/fileController');

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Multer disk storage — UUID filenames to prevent collisions/traversal
const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    cb(null, `${crypto.randomUUID()}${ext}`);
  }
});

const uploadSingle = fileUpload(storage);

// ─── Upload-permission API routes ────────────────────────────────────────────

const canUpload = requirePermission('uploadFiles');

router.post('/api/files/upload', canUpload, uploadLimiter, uploadSingle, fileController.upload);
router.get('/api/files', canUpload, fileController.list);
router.delete('/api/files/:id', canUpload, fileController.delete);
router.patch('/api/files/:id', canUpload, fileController.updateSettings);

// ─── Admin routes ─────────────────────────────────────────────────────────────

router.get('/admin/files', isAuthenticated, isAdmin, fileController.adminList);
router.delete('/api/admin/files/:id', isAuthenticated, isAdmin, fileController.adminDelete);
router.post('/api/admin/files/:id/block', isAuthenticated, isAdmin, fileController.adminBlock);
router.post('/api/admin/files/:id/unblock', isAuthenticated, isAdmin, fileController.adminUnblock);

// ─── Unlock file (password) ───────────────────────────────────────────────────


// ─── Public file routes ───────────────────────────────────────────────────────

// Never let a browser guess a type from the bytes (the download also gets CSP sandbox)
router.use('/f', (req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  next();
});

router.get('/f/:slug/download', fileController.download);
router.get('/f/:slug', fileController.preview);

module.exports = router;
