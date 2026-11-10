const express = require('express');
const router = express.Router();
const NotificationController = require('../controllers/notificationController');
const { isAuthenticated } = require('../middleware/auth');

// Mounted with featureRoutes('notifications', …): all of it is a 404 while the feature is off.

router.get('/notifications', isAuthenticated, NotificationController.page);
router.post('/api/notifications/read', isAuthenticated, NotificationController.markRead);
router.post('/api/notifications/read-all', isAuthenticated, NotificationController.markAllRead);

router.get('/api/user/notification-preferences', isAuthenticated, NotificationController.getPreferences);
router.put('/api/user/notification-preferences', isAuthenticated, NotificationController.updatePreferences);

// Unsubscribe links in mails (open to visitors, also on a private instance: requireLogin OPEN_PREFIXES).
// GET only asks (mail scanners open links); POST turns the mail off, also as a one-click POST from a mail app.
router.get('/notifications/unsubscribe/:key/:event', NotificationController.showUnsubscribe);
router.post('/notifications/unsubscribe/:key/:event', NotificationController.unsubscribe);

module.exports = router;
