const express = require('express');
const router = express.Router();
const AdminItemController = require('../controllers/adminItemController');
const { isAuthenticated, isAdmin } = require('../middleware/auth');

// Admin actions for every content type (:type = url | bundle | paste | file).
// Other /api/admin/… addresses (users, reports, settings) fall through.
const admin = [AdminItemController.knownType, isAuthenticated, isAdmin];

router.post('/api/admin/:type/bulk-block', admin, AdminItemController.bulkBlock);
router.post('/api/admin/:type/bulk-unblock', admin, AdminItemController.bulkUnblock);
router.post('/api/admin/:type/:id/block', admin, AdminItemController.block);
router.post('/api/admin/:type/:id/unblock', admin, AdminItemController.unblock);
router.delete('/api/admin/:type/:id', admin, AdminItemController.remove);

module.exports = router;
