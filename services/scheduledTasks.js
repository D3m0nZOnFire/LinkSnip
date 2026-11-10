const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const AuditLog = require('../models/AuditLog');
const Url = require('../models/Url');
const Bundle = require('../models/Bundle');
const AnalyticsShare = require('../models/AnalyticsShare');
const UserToken = require('../models/UserToken');
const AnalyticsEvent = require('../models/AnalyticsEvent');
const File = require('../models/File');
const Paste = require('../models/Paste');
const paths = require('../config/paths');
const configService = require('./configService');
const geo = require('./geoService');
const db = require('../config/database');
const notifications = require('./notificationService');
const { contentType, enabledTypes } = require('./contentTypes');
const { toTime } = require('./accessService');

const DAY_MS = 24 * 60 * 60 * 1000;
// What happens to a registered user's expired item: deleted after retention.expiredGraceDays (links, pastes), at the
// next nightly file cleanup (files), or kept (bundles). Tells the "expired" notice what to say.
const EXPIRED_ITEM_DELETION = { url: 'grace', paste: 'grace', file: 'tonight', bundle: null };
// SQL: when an item stops working (the earlier of expiresAt and deactivateAt), as a julianday; NULL when neither is set
const END_SQL = 'MIN(COALESCE(julianday(expiresAt), 9e9), COALESCE(julianday(deactivateAt), 9e9))';

/**
 * Scheduled Tasks Service
 * Handles periodic maintenance tasks like log cleanup, database backups, and expired URL cleanup
 */

// A stored date as a julianday (zone-less dates are UTC, as SQLite reads them)
const julianDay = (value) => (toTime(value) ?? 0) / DAY_MS + 2440587.5;

class ScheduledTasks {
  static init() {
    // Run audit log cleanup daily at 2 AM
    cron.schedule('0 2 * * *', () => {
      console.log('🧹 Running scheduled audit log cleanup...');
      this.cleanupAuditLogs();
    });

    // Delete old analytics events daily at 2:15 AM (only when retention.analyticsDays is set)
    cron.schedule('15 2 * * *', () => {
      this.cleanupAnalytics();
    });

    // Run database backup daily at 3 AM
    cron.schedule('0 3 * * *', () => {
      console.log('💾 Running scheduled database backup...');
      this.backupDatabase().catch(error => console.error('❌ Database backup failed:', error));
    });

    // Run inactive URL cleanup daily at 4 AM (expired + deactivated, anonymous immediately, registered with grace period)
    cron.schedule('0 4 * * *', () => {
      console.log('🔗 Running scheduled inactive URL cleanup...');
      this.cleanupInactiveUrls();
    });

    // Run expired analytics shares cleanup daily at 5 AM
    cron.schedule('0 5 * * *', () => {
      console.log('🔗 Running scheduled expired analytics shares cleanup...');
      this.cleanupExpiredShares();
      this.cleanupExpiredTokens();
      this.cleanupUnconfirmedAccounts();
    });

    // Run expired file cleanup daily at 5:30 AM
    cron.schedule('30 5 * * *', () => {
      console.log('📁 Running scheduled expired file cleanup...');
      this.cleanupExpiredFiles();
    });

    // Check the country database daily at 5:45 AM (downloads only when DB-IP has a newer month)
    cron.schedule('45 5 * * *', () => {
      this.updateGeoDatabase();
    });

    // Notification mails that are due, every minute; expiry notices hourly; old read notifications nightly
    cron.schedule('* * * * *', () => {
      notifications.sendDue().catch(error => console.error('❌ Notification mails failed:', error));
    });
    cron.schedule('10 * * * *', () => this.notifyLifecycle());
    cron.schedule('5 2 * * *', () => this.cleanupNotifications());

    console.log('⏰ Scheduled tasks initialized:');
    console.log('   - Audit log cleanup: Daily at 2:00 AM');
    console.log('   - Analytics cleanup (retention.analyticsDays, off by default): Daily at 2:15 AM');
    console.log('   - Database backup: Daily at 3:00 AM');
    console.log('   - Inactive URL cleanup (expired + deactivated, anonymous immediately / registered with grace period): Daily at 4:00 AM');
    console.log('   - Expired analytics shares, mail links and never-confirmed sign-ups (7 days) cleanup: Daily at 5:00 AM');
    console.log('   - Expired file cleanup: Daily at 5:30 AM');
    console.log('   - Country database check (DB-IP Lite, monthly file): Daily at 5:45 AM');
    console.log('   - Notification mails: every minute; expiry notices: hourly; read notifications cleanup: Daily at 2:05 AM');
  }

  /**
   * Download a newer DB-IP country database if there is one (also run at startup).
   * Never throws: without the file, countries are recorded as Unknown.
   */
  static async updateGeoDatabase() {
    const result = await geo.update();
    if (result.status === 'updated') {
      console.log(`🌍 Country database updated (DB-IP Lite ${result.month})`);
    } else if (result.status === 'failed') {
      console.warn(`⚠️  Country database not updated: ${result.error}. ` +
        'Without it, visitor countries are recorded as Unknown. Retrying daily at 5:45.');
    }
  }

  /**
   * Clean up audit logs older than retention period
   */
  static cleanupAuditLogs() {
    try {
      const retentionDays = configService.get('retention.auditLogDays');

      const deletedCount = AuditLog.deleteOlderThan(retentionDays);

      if (deletedCount > 0) {
        console.log(`✅ Deleted ${deletedCount} audit logs older than ${retentionDays} days`);
      } else {
        console.log(`✅ No audit logs to clean up (retention: ${retentionDays} days)`);
      }
    } catch (error) {
      console.error('❌ Audit log cleanup failed:', error);
    }
  }

  /**
   * Delete analytics events older than retention.analyticsDays (null: keep forever).
   */
  static cleanupAnalytics() {
    try {
      const days = configService.get('retention.analyticsDays');
      if (days == null) return;
      const deleted = AnalyticsEvent.deleteOlderThan(days);
      console.log(`📊 Deleted ${deleted} analytics event(s) older than ${days} days`);
    } catch (error) {
      console.error('❌ Analytics cleanup failed:', error);
    }
  }

  /**
   * Create a database backup with SQLite's online backup API, which gives a
   * consistent copy while the app keeps writing (copying the live file does not).
   * @returns {Promise<string>} Path of the backup file
   */
  static async backupDatabase() {
    const db = require('../config/database');
    fs.mkdirSync(paths.BACKUPS_DIR, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(paths.BACKUPS_DIR, `database-backup-${timestamp}.sqlite`);

    await db.backup(backupPath);
    console.log(`✅ Database backup created: ${path.basename(backupPath)}`);

    // Clean up old backups (keep only last 30 days)
    this.cleanupOldBackups(paths.BACKUPS_DIR, 30);
    return backupPath;
  }

  /**
   * Delete backup files older than retention period
   */
  static cleanupOldBackups(backupsDir, retentionDays) {
    try {
      const files = fs.readdirSync(backupsDir);
      const now = Date.now();
      const maxAge = retentionDays * 24 * 60 * 60 * 1000; // Convert days to milliseconds

      let deletedCount = 0;

      files.forEach(file => {
        if (!file.startsWith('database-backup-')) return;

        const filePath = path.join(backupsDir, file);
        const stats = fs.statSync(filePath);
        const fileAge = now - stats.mtime.getTime();

        if (fileAge > maxAge) {
          fs.unlinkSync(filePath);
          deletedCount++;
        }
      });

      if (deletedCount > 0) {
        console.log(`🧹 Deleted ${deletedCount} old backup(s) (retention: ${retentionDays} days)`);
      }
    } catch (error) {
      console.error('❌ Backup cleanup failed:', error);
    }
  }

  /**
   * Manual backup (can be called from admin panel)
   */
  static manualBackup() {
    console.log('💾 Manual backup requested...');
    return this.backupDatabase();
  }

  /**
   * Manual cleanup (can be called from admin panel)
   */
  static manualCleanup() {
    console.log('🧹 Manual cleanup requested...');
    this.cleanupAuditLogs();
  }

  /**
   * Clean up inactive URLs (expired or deactivated):
   * - Anonymous: deleted immediately
   * - Registered users: deleted after the grace period (default 90 days)
   */
  static cleanupInactiveUrls() {
    try {
      const graceDays = configService.get('retention.expiredGraceDays');
      const anonDeleted = Url.deleteInactiveAnonymous();
      this.notifyDeleted('url', Url.findInactiveRegistered(graceDays));
      this.notifyDeleted('paste', Paste.findInactiveRegistered(graceDays));
      const registeredDeleted = Url.deleteInactiveRegistered(graceDays);
      const anonBundlesDeleted = Bundle.deleteInactiveAnonymous();
      const anonPastesDeleted = Paste.deleteInactiveAnonymous();
      const registeredPastesDeleted = Paste.deleteInactiveRegistered(graceDays);
      const total = anonDeleted + registeredDeleted + anonBundlesDeleted + anonPastesDeleted + registeredPastesDeleted;

      if (total > 0) {
        console.log(`✅ Deleted ${anonDeleted} inactive anonymous URL(s), ${registeredDeleted} inactive registered URL(s) past ${graceDays}-day grace period, ${anonBundlesDeleted} inactive anonymous bundle(s), ${anonPastesDeleted} inactive anonymous paste(s), and ${registeredPastesDeleted} inactive registered paste(s) past the grace period`);
      } else {
        console.log(`✅ No inactive URLs, bundles or pastes to clean up`);
      }
    } catch (error) {
      console.error('❌ Inactive URL cleanup failed:', error);
    }
  }

  /**
   * Delete expired files from disk and database
   */
  static cleanupExpiredFiles() {
    try {
      const uploadsDir = paths.UPLOADS_DIR;
      const expired = File.findExpired();

      let deletedCount = 0;
      this.notifyDeleted('file', expired);
      for (const file of expired) {
        try {
          const filePath = path.join(uploadsDir, file.storedName);
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch (_) {}
        File.delete(file.id);
        deletedCount++;
      }

      if (deletedCount > 0) {
        console.log(`✅ Deleted ${deletedCount} expired file(s) from disk and database`);
      } else {
        console.log('✅ No expired files to clean up');
      }
    } catch (error) {
      console.error('❌ Expired file cleanup failed:', error);
    }
  }

  /**
   * Clean up expired analytics shares
   */
  static cleanupExpiredShares() {
    try {
      const deletedCount = AnalyticsShare.deleteExpired();

      if (deletedCount > 0) {
        console.log(`✅ Deleted ${deletedCount} expired analytics share(s)`);
      } else {
        console.log(`✅ No expired analytics shares to clean up`);
      }
    } catch (error) {
      console.error('❌ Expired analytics shares cleanup failed:', error);
    }
  }

  /** Tells the owners of items the cleanup is about to delete (anonymous ones have nobody to tell). */
  static notifyDeleted(type, items) {
    for (const item of items) notifications.notifyItemOwner(type, item, 'deleted_by_cleanup', { deleted: true });
  }

  /**
   * Hourly: tells owners once that an item expires within notifications.expiryWarningDays (items made to last less
   * than that get no warning), and once that it expired (in the last day), with the days left before it is deleted.
   * A new expiry date makes a new occurrence. Blocked items and anonymous ones are left out.
   */
  static notifyLifecycle(now = new Date()) {
    try {
      const nowDay = now.getTime() / DAY_MS + 2440587.5; // julianday
      const warnDays = configService.get('notifications.expiryWarningDays');
      const graceDays = configService.get('retention.expiredGraceDays');
      for (const type of enabledTypes()) {
        const info = contentType(type);
        const rows = db.prepare(`
          SELECT *, ${END_SQL} AS endDay FROM ${info.table}
          WHERE ${info.ownerColumn} IS NOT NULL AND isBlocked = 0
            AND ${END_SQL} BETWEEN ? - 1 AND ? + ?
        `).all(nowDay, nowDay, warnDays);
        for (const item of rows) {
          const occurrence = item.endDay.toFixed(6);
          if (item.endDay > nowDay) {
            if (item.endDay - julianDay(item.createdAt) <= warnDays) continue;
            notifications.notifyItemOwner(type, item, 'expires_soon', {
              payload: { days: Math.ceil(item.endDay - nowDay) }, dedupe: occurrence
            });
          } else {
            const deletion = EXPIRED_ITEM_DELETION[type];
            const days = deletion === 'grace' ? Math.max(0, Math.ceil(graceDays - (nowDay - item.endDay)))
              : deletion === 'tonight' ? 0 : null;
            notifications.notifyItemOwner(type, item, 'expired', { payload: { days }, dedupe: occurrence });
          }
        }
      }
    } catch (error) {
      console.error('❌ Expiry notifications failed:', error);
    }
  }

  /** Notifications read more than 30 days ago (unread ones stay). */
  static cleanupNotifications() {
    try {
      const deleted = notifications.cleanup();
      if (deleted > 0) console.log(`✅ Deleted ${deleted} old notification(s)`);
    } catch (error) {
      console.error('❌ Notification cleanup failed:', error);
    }
  }

  /** Deletes accounts that signed up and never confirmed their address (services/accountEmail.js). */
  static cleanupUnconfirmedAccounts() {
    try {
      const { unconfirmedAccountIds } = require('./accountEmail');
      const { deleteAccount } = require('./accountDeletion');
      const ids = unconfirmedAccountIds();
      ids.forEach(id => deleteAccount(id));
      if (ids.length) console.log(`✅ Deleted ${ids.length} account(s) whose email address was never confirmed`);
    } catch (error) {
      console.error('❌ Unconfirmed account cleanup failed:', error);
    }
  }

  /** Deletes one-time mail links (address verification, password reset) that ended more than a day ago. */
  static cleanupExpiredTokens() {
    try {
      const deletedCount = UserToken.deleteExpired();
      if (deletedCount > 0) console.log(`✅ Deleted ${deletedCount} old mail link(s)`);
    } catch (error) {
      console.error('❌ Mail link cleanup failed:', error);
    }
  }
}

module.exports = ScheduledTasks;
