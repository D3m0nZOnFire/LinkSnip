const express = require('express');
const router = express.Router();
const multer = require('multer');
const ImportExportController = require('../controllers/importExportController');
const { isAuthenticated } = require('../middleware/auth');
const { bulkImportLimiter } = require('../middleware/rateLimiter');
const requirePermission = require('../middleware/requirePermission');

// Configure multer for file upload (memory storage for parsing)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
  },
  fileFilter: (req, file, cb) => {
    // Accept CSV, JSON, and TXT files
    const allowedTypes = ['text/csv', 'application/json', 'text/plain', 'application/vnd.ms-excel'];
    const allowedExts = ['.csv', '.json', '.txt'];

    const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));

    if (allowedTypes.includes(file.mimetype) || allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only CSV, JSON, and TXT files are allowed.'));
    }
  }
});

// Import/Export routes (all require authentication)
const canImportExport = requirePermission('importExport');

router.get('/import', isAuthenticated, canImportExport, ImportExportController.getImportPage);
router.post('/api/import', isAuthenticated, canImportExport, bulkImportLimiter, upload.single('file'), ImportExportController.importUrls);
router.get('/api/export', isAuthenticated, canImportExport, ImportExportController.exportUrls);
router.get('/api/import/template', isAuthenticated, canImportExport, ImportExportController.downloadTemplate);

module.exports = router;
