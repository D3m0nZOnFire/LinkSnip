const Notification = require('../models/Notification');
const notifications = require('../services/notificationService');
const events = require('../services/notificationEvents');
const { sendNotFound } = require('../middleware/notFound');

/**
 * The Notifications page, marking read, preferences (Settings → Notifications) and unsubscribe links from mails.
 * Opening the page marks the notifications it shows as read: a notification seen there is left out of its mail.
 */

const PER_PAGE = 25;

/** A stored row as the page shows it. */
function present(row) {
  const { text, path } = events.describe(row.event, row.payload);
  const spec = events.event(row.event);
  return { id: row.id, event: row.event, group: spec ? spec.group : null, text, path, createdAt: row.createdAt, unread: !row.readAt };
}

const unsubscribeLabel = (name) => (name === notifications.UNSUBSCRIBE_ALL
  ? 'notification mails'
  : `mails for "${events.event(name).label}"`);

class NotificationController {
  /** GET /notifications */
  static page(req, res) {
    const total = Notification.countForUser(req.user.id);
    const pages = Math.max(1, Math.ceil(total / PER_PAGE));
    const page = Math.min(Math.max(parseInt(req.query.page, 10) || 1, 1), pages);
    const rows = Notification.listForUser(req.user.id, { limit: PER_PAGE, offset: (page - 1) * PER_PAGE });
    const items = rows.map(present);

    // Seen now: shown as new this once, then read (and no longer mailed)
    Notification.markRead(req.user.id, rows.filter(row => !row.readAt).map(row => row.id));
    res.locals.notificationsUnread = Notification.unreadCount(req.user.id);

    res.render('notifications', { user: req.user, items, page, pages, total, unreadElsewhere: res.locals.notificationsUnread });
  }

  /** POST /api/notifications/read { ids } */
  static markRead(req, res) {
    const { ids } = req.body || {};
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids must be an array' });
    Notification.markRead(req.user.id, ids);
    res.json({ success: true, unread: Notification.unreadCount(req.user.id) });
  }

  /** POST /api/notifications/read-all */
  static markAllRead(req, res) {
    Notification.markAllRead(req.user.id);
    res.json({ success: true, unread: 0 });
  }

  /** GET /api/user/notification-preferences */
  static getPreferences(req, res) {
    res.json({ preferences: notifications.preferences(req.user.id) });
  }

  /** PUT /api/user/notification-preferences { preferences: { event: { inApp, mail } } } */
  static updatePreferences(req, res) {
    const { preferences } = req.body || {};
    if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) {
      return res.status(400).json({ error: 'preferences must be an object' });
    }
    notifications.setPreferences(req.user.id, preferences);
    res.json({ success: true, preferences: notifications.preferences(req.user.id) });
  }

  /** GET /notifications/unsubscribe/:key/:event: asks first */
  static showUnsubscribe(req, res) {
    const found = notifications.findUnsubscribe(req.params.key, req.params.event);
    if (!found) return sendNotFound(req, res);
    res.render('notifications-unsubscribe', {
      done: false, username: found.username, what: unsubscribeLabel(found.event), action: req.originalUrl.split('?')[0]
    });
  }

  /** POST /notifications/unsubscribe/:key/:event: from the page, or one-click from a mail app (RFC 8058) */
  static unsubscribe(req, res) {
    const found = notifications.findUnsubscribe(req.params.key, req.params.event);
    if (!found) return sendNotFound(req, res);
    notifications.unsubscribe(req.params.key, req.params.event);
    if (req.body && req.body['List-Unsubscribe'] === 'One-Click') return res.type('text/plain').send('Unsubscribed');
    res.render('notifications-unsubscribe', {
      done: true, username: found.username, what: unsubscribeLabel(found.event), action: null
    });
  }
}

module.exports = NotificationController;
