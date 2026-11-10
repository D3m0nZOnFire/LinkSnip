const db = require('../config/database');

/**
 * Notification rows (config/migrations.js migrateNotifications): the in-app list (inApp = 1) and the mail queue
 * (mailState). Rules live in services/notificationService.js; this is the SQL.
 */

const parse = (row) => (row ? { ...row, payload: JSON.parse(row.payload || '{}') } : null);
const now = () => new Date().toISOString();
const placeholders = (ids) => ids.map(() => '?').join(', ');

class Notification {
  /**
   * @returns {object|null} The new row, or null when its dedupeKey already exists
   */
  static create({ userId, event, targetType = null, targetId = null, payload = {}, inApp, mailState, mailAfter = null, dedupeKey = null }) {
    const { changes, lastInsertRowid } = db.prepare(`
      INSERT OR IGNORE INTO notifications (userId, event, targetType, targetId, payload, inApp, mailState, mailAfter, dedupeKey)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, event, targetType, targetId, JSON.stringify(payload), inApp ? 1 : 0, mailState, mailAfter, dedupeKey);
    return changes ? Notification.findById(lastInsertRowid) : null;
  }

  static findById(id) {
    return parse(db.prepare('SELECT * FROM notifications WHERE id = ?').get(id));
  }

  /** In-app rows, newest first. */
  static listForUser(userId, { limit = 50, offset = 0 } = {}) {
    return db.prepare(`
      SELECT * FROM notifications WHERE userId = ? AND inApp = 1 ORDER BY createdAt DESC, id DESC LIMIT ? OFFSET ?
    `).all(userId, limit, offset).map(parse);
  }

  static countForUser(userId) {
    return db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE userId = ? AND inApp = 1').get(userId).n;
  }

  static unreadCount(userId) {
    return db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE userId = ? AND inApp = 1 AND readAt IS NULL').get(userId).n;
  }

  /** Marks the user's own rows among `ids` read. @returns {number} rows changed */
  static markRead(userId, ids) {
    const list = (ids || []).map(Number).filter(Number.isInteger);
    if (list.length === 0) return 0;
    return db.prepare(`
      UPDATE notifications SET readAt = ? WHERE userId = ? AND readAt IS NULL AND id IN (${placeholders(list)})
    `).run(now(), userId, ...list).changes;
  }

  static markAllRead(userId) {
    return db.prepare('UPDATE notifications SET readAt = ? WHERE userId = ? AND inApp = 1 AND readAt IS NULL')
      .run(now(), userId).changes;
  }

  /** Users with at least one pending row whose mailAfter has passed. */
  static usersDueForMail(at = new Date()) {
    return db.prepare(`
      SELECT DISTINCT userId FROM notifications
      WHERE mailState = 'pending' AND julianday(mailAfter) <= julianday(?)
    `).all(at.toISOString()).map(r => r.userId);
  }

  /** Every pending row of a user, oldest first. */
  static pendingForUser(userId) {
    return db.prepare(`SELECT * FROM notifications WHERE userId = ? AND mailState = 'pending' ORDER BY createdAt, id`)
      .all(userId).map(parse);
  }

  static setMailState(ids, state) {
    if (ids.length === 0) return 0;
    const mailedAt = state === 'sent' ? now() : null;
    return db.prepare(`UPDATE notifications SET mailState = ?, mailedAt = COALESCE(?, mailedAt) WHERE id IN (${placeholders(ids)})`)
      .run(state, mailedAt, ...ids).changes;
  }

  /** Every pending row, whoever it is for (mail switched off: nothing will send them). */
  static skipAllPending() {
    return db.prepare("UPDATE notifications SET mailState = 'skipped' WHERE mailState = 'pending'").run().changes;
  }

  /** Unread rows of an event on an item that were not mailed (pending or no mail). */
  static deleteUnsent(event, targetType, targetId) {
    return db.prepare(`
      DELETE FROM notifications
      WHERE event = ? AND targetType = ? AND targetId = ? AND readAt IS NULL AND mailState IN ('pending', 'none')
    `).run(event, targetType, targetId).changes;
  }

  /**
   * Rows read more than `days` ago, and mail-only rows done with more than `days` ago (nothing to read).
   * Unread rows stay.
   */
  static deleteOld(days) {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    return db.prepare(`
      DELETE FROM notifications
      WHERE (readAt IS NOT NULL AND julianday(readAt) < julianday(?))
         OR (inApp = 0 AND mailState IN ('sent', 'skipped', 'none') AND julianday(createdAt) < julianday(?))
    `).run(cutoff, cutoff).changes;
  }
}

module.exports = Notification;
