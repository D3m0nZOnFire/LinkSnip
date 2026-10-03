const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const paths = require('../config/paths');
const configService = require('./configService');
const { CONTENT_TYPES, isTypeEnabled } = require('./contentTypes');
const { statusSql } = require('./accessService');
const { listQuarantined } = require('./moderationService');
const Report = require('../models/Report');
const AuditLog = require('../models/AuditLog');

/**
 * What Admin → Overview shows: counts per content type, people, storage, visits, what needs attention (reports,
 * quarantine), recent audit entries and the state of the nightly backup. Read per request.
 */

const LABELS = { url: 'Links', bundle: 'Bundles', paste: 'Pastes', file: 'Files' };
const WEEK = "julianday('now', '-7 days')";
const QUARANTINE_SHOWN = 5;
const RECENT_SHOWN = 8;

function items() {
  return Object.entries(CONTENT_TYPES).filter(([type]) => isTypeEnabled(type)).map(([type, info]) => {
    const status = statusSql(type, { alias: 't' });
    const row = db.prepare(`
      SELECT COUNT(*) AS total,
             COALESCE(SUM(CASE WHEN ${status.sql} = 'active' THEN 1 ELSE 0 END), 0) AS live,
             COALESCE(SUM(CASE WHEN julianday(t.createdAt) >= ${WEEK} THEN 1 ELSE 0 END), 0) AS newThisWeek
      FROM ${info.table} t
    `).get(...status.params);
    return { type, label: LABELS[type], ...row };
  });
}

function users() {
  return db.prepare(`
    SELECT COUNT(*) AS total,
           COALESCE(SUM(CASE WHEN isAdmin = 1 THEN 1 ELSE 0 END), 0) AS admins,
           COALESCE(SUM(CASE WHEN isBanned = 1 THEN 1 ELSE 0 END), 0) AS banned,
           COALESCE(SUM(CASE WHEN julianday(createdAt) >= ${WEEK} THEN 1 ELSE 0 END), 0) AS newThisWeek,
           COALESCE(SUM(CASE WHEN julianday(lastActive) >= ${WEEK} THEN 1 ELSE 0 END), 0) AS activeThisWeek
    FROM users
  `).get();
}

function visits() {
  // Bundle item clicks (subTargetId) are part of their bundle's visit
  return db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN julianday(timestamp) >= ${WEEK} THEN 1 ELSE 0 END), 0) AS lastWeek,
           COALESCE(SUM(CASE WHEN julianday(timestamp) < ${WEEK}
                              AND julianday(timestamp) >= julianday('now', '-14 days') THEN 1 ELSE 0 END), 0) AS weekBefore
    FROM analytics_events
    WHERE subTargetId IS NULL
  `).get();
}

function moderation() {
  if (!configService.get('features.reports')) return null;
  const quarantined = listQuarantined().filter(item => isTypeEnabled(item.type));
  return {
    pendingReports: Report.count({ status: 'pending' }),
    quarantined: quarantined.slice(0, QUARANTINE_SHOWN),
    quarantinedTotal: quarantined.length
  };
}

function backups() {
  let files = [];
  try {
    files = fs.readdirSync(paths.BACKUPS_DIR).filter(f => /^database-backup-.*\.sqlite$/.test(f)).sort();
  } catch (_) { /* no backups yet */ }
  const newest = files[files.length - 1];
  if (!newest) return { lastBackup: null, backups: 0 };
  const stat = fs.statSync(path.join(paths.BACKUPS_DIR, newest));
  return { lastBackup: { file: newest, at: stat.mtime.toISOString(), bytes: stat.size }, backups: files.length };
}

function summary() {
  return {
    items: items(),
    users: users(),
    teams: configService.get('features.teams') ? db.prepare('SELECT COUNT(*) AS n FROM teams').get().n : null,
    storage: db.prepare('SELECT COUNT(*) AS files, COALESCE(SUM(size), 0) AS bytes FROM files').get(),
    visits: configService.get('features.analytics') ? visits() : null,
    moderation: moderation(),
    recentActivity: AuditLog.findAll({ limit: RECENT_SHOWN }),
    system: { version: require('../package.json').version, ...backups() }
  };
}

module.exports = { summary };
