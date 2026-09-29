const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const AuditLog = require('../models/AuditLog');
const Url = require('../models/Url');
const Bundle = require('../models/Bundle');
const AnalyticsShare = require('../models/AnalyticsShare');
const File = require('../models/File');
const Paste = require('../models/Paste');
const paths = require('../config/paths');
const configService = require('./configService');

/**
 * Scheduled Tasks Service
 * Handles periodic maintenance tasks like log cleanup, database backups, and expired URL cleanup
 */

class ScheduledTasks {
  static init() {
    // Run audit log cleanup daily at 2 AM
    cron.schedule('0 2 * * *', () => {
      console.log('🧹 Running scheduled audit log cleanup...');
      this.cleanupAuditLogs();
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
    });

    // Run expired file cleanup daily at 5:30 AM
    cron.schedule('30 5 * * *', () => {
      console.log('📁 Running scheduled expired file cleanup...');
      this.cleanupExpiredFiles();
    });

    console.log('⏰ Scheduled tasks initialized:');
    console.log('   - Audit log cleanup: Daily at 2:00 AM');
    console.log('   - Database backup: Daily at 3:00 AM');
    console.log('   - Inactive URL cleanup (expired + deactivated, anonymous immediately / registered with grace period): Daily at 4:00 AM');
    console.log('   - Expired analytics shares cleanup: Daily at 5:00 AM');
    console.log('   - Expired file cleanup: Daily at 5:30 AM');
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
}

module.exports = ScheduledTasks;
