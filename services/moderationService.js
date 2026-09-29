const db = require('../config/database');
const User = require('../models/User');
const RoleService = require('./roleService');
const configService = require('./configService');
const { logSecurity, ACTIONS } = require('./auditService');

/**
 * Report-driven moderation for links and bundles.
 *
 * When a link reaches moderation.reportThreshold distinct (pending) reports it is
 * quarantined, not blocked: visitors see a warning page first, and it goes to the
 * top of Admin → Reports. An admin then either blocks it (a hard block) or clears
 * it (reports dismissed, quarantine lifted). A threshold of 0 turns automatic
 * quarantine off. Links owned by admins or by a role with skipAutoModeration are
 * never quarantined.
 */

// The two reportable types share the same shape; Phase 2 unifies the tables.
const TYPES = {
  url: {
    table: 'urls', reports: 'url_reports', fk: 'urlId', target: 'longUrl', prefix: '/s/',
    actions: { quarantine: ACTIONS.QUARANTINE_URL, block: ACTIONS.BLOCK_URL }
  },
  bundle: {
    table: 'bundles', reports: 'bundle_reports', fk: 'bundleId', target: 'title', prefix: '/b/',
    actions: { quarantine: ACTIONS.QUARANTINE_BUNDLE, block: ACTIONS.BLOCK_BUNDLE }
  }
};

class ModerationError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function typeInfo(type) {
  const info = TYPES[type];
  if (!info) throw new ModerationError(`Unknown type: ${type}`, 400);
  return info;
}

function findItem(info, id) {
  const item = db.prepare(`SELECT * FROM ${info.table} WHERE id = ?`).get(id);
  if (!item) throw new ModerationError(`${info.table === 'urls' ? 'Link' : 'Bundle'} not found`, 404);
  return item;
}

const pendingCount = (info, id) =>
  db.prepare(`SELECT COUNT(*) AS n FROM ${info.reports} WHERE ${info.fk} = ? AND status = 'pending'`).get(id).n;

function isExempt(item) {
  if (!item.creatorId) return false;
  const owner = User.findById(item.creatorId);
  return !!owner && RoleService.can(owner, 'skipAutoModeration'); // admins always can
}

/**
 * Call after a report is stored. Quarantines the item when it reaches the threshold.
 * @returns {boolean} Whether the item is quarantined now
 */
function afterReport(type, id, req) {
  const info = typeInfo(type);
  const item = findItem(info, id);
  if (item.isQuarantined) return true;

  const threshold = configService.get('moderation.reportThreshold');
  if (threshold === 0 || item.isBlocked || isExempt(item)) return false;

  const reports = pendingCount(info, id);
  if (reports < threshold) return false;

  db.prepare(`UPDATE ${info.table} SET isQuarantined = 1 WHERE id = ?`).run(id);
  logSecurity(info.actions.quarantine, req, type, id, `${info.prefix}${item.slug}`, {
    reportCount: reports,
    threshold,
    reason: 'Automatic quarantine after reports'
  });
  return true;
}

function resolveReports(info, id, status, req) {
  db.prepare(`
    UPDATE ${info.reports} SET status = ?, reviewedBy = ?, reviewedAt = CURRENT_TIMESTAMP
    WHERE ${info.fk} = ? AND status = 'pending'
  `).run(status, req.user ? req.user.id : null, id);
}

/** Hard-block the item, lift its quarantine, and mark its pending reports blocked. */
function block(type, id, req) {
  const info = typeInfo(type);
  const item = findItem(info, id);
  db.transaction(() => {
    db.prepare(`UPDATE ${info.table} SET isBlocked = 1, isQuarantined = 0 WHERE id = ?`).run(id);
    resolveReports(info, id, 'blocked', req);
  })();
  logSecurity(info.actions.block, req, type, id, `${info.prefix}${item.slug}`, { via: 'moderation' });
}

/** Lift the quarantine and dismiss the pending reports. */
function clear(type, id, req) {
  const info = typeInfo(type);
  const item = findItem(info, id);
  db.transaction(() => {
    db.prepare(`UPDATE ${info.table} SET isQuarantined = 0 WHERE id = ?`).run(id);
    resolveReports(info, id, 'dismissed', req);
  })();
  logSecurity(ACTIONS.CLEAR_QUARANTINE, req, type, id, `${info.prefix}${item.slug}`, {});
}

/** Quarantined links and bundles, most reported first, for the top of Admin → Reports. */
function listQuarantined() {
  const items = [];
  for (const [type, info] of Object.entries(TYPES)) {
    const rows = db.prepare(`
      SELECT t.id, t.slug, t.${info.target} AS target, t.creatorId,
             (SELECT COUNT(*) FROM ${info.reports} r WHERE r.${info.fk} = t.id AND r.status = 'pending') AS pendingReports,
             (SELECT GROUP_CONCAT(DISTINCT r.reason) FROM ${info.reports} r WHERE r.${info.fk} = t.id AND r.status = 'pending') AS reasons
      FROM ${info.table} t
      WHERE t.isQuarantined = 1
    `).all();
    for (const row of rows) {
      items.push({ type, ...row, path: `${info.prefix}${row.slug}`, reasons: row.reasons ? row.reasons.split(',') : [] });
    }
  }
  return items.sort((a, b) => b.pendingReports - a.pendingReports);
}

module.exports = { afterReport, block, clear, listQuarantined, ModerationError };
