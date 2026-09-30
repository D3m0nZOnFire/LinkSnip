const db = require('../config/database');
const User = require('../models/User');
const Report = require('../models/Report');
const RoleService = require('./roleService');
const configService = require('./configService');
const { logSecurity, logAdminAction, ACTIONS } = require('./auditService');
const { CONTENT_TYPES } = require('./contentTypes');

/**
 * Report-driven moderation for every content type (links, bundles, pastes, files).
 *
 * When an item reaches moderation.reportThreshold distinct (pending) reports it is
 * quarantined, not blocked: visitors see a warning page first, and it goes to the
 * top of Admin → Reports. An admin then either blocks it (a hard block) or clears
 * it (reports dismissed, quarantine lifted). A threshold of 0 turns automatic
 * quarantine off. Items owned by admins or by a role with skipAutoModeration are
 * never quarantined.
 */

class ModerationError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// Audit action for `kind` (QUARANTINE, BLOCK, UNBLOCK) on a type: QUARANTINE_URL, BLOCK_PASTE, …
const action = (kind, type) => ACTIONS[`${kind}_${type.toUpperCase()}`];

function typeInfo(type) {
  const info = CONTENT_TYPES[type];
  if (!info) throw new ModerationError(`Unknown type: ${type}`, 400);
  return info;
}

function findItem(type, id) {
  const info = typeInfo(type);
  const item = db.prepare(`SELECT * FROM ${info.table} WHERE id = ?`).get(id);
  if (!item) {
    const noun = info.noun.charAt(0).toUpperCase() + info.noun.slice(1);
    throw new ModerationError(`${noun} not found`, 404);
  }
  return { info, item };
}

const pathOf = (info, item) => `${info.publicPrefix}${item.slug}`;

function isExempt(info, item) {
  const ownerId = item[info.ownerColumn];
  if (!ownerId) return false;
  const owner = User.findById(ownerId);
  return !!owner && RoleService.can(owner, 'skipAutoModeration'); // admins always can
}

/**
 * Call after a report is stored. Quarantines the item when it reaches the threshold.
 * @returns {boolean} Whether the item is quarantined now
 */
function afterReport(type, id, req) {
  const { info, item } = findItem(type, id);
  if (item.isQuarantined) return true;

  const threshold = configService.get('moderation.reportThreshold');
  if (threshold === 0 || item.isBlocked || isExempt(info, item)) return false;

  const reports = Report.countPending(type, id);
  if (reports < threshold) return false;

  db.prepare(`UPDATE ${info.table} SET isQuarantined = 1 WHERE id = ?`).run(id);
  logSecurity(action('QUARANTINE', type), req, type, id, pathOf(info, item), {
    reportCount: reports,
    threshold,
    reason: 'Automatic quarantine after reports'
  });
  return true;
}

const reviewerId = (req) => (req.user ? req.user.id : null);

/** Hard-block the item, lift its quarantine, and mark its pending reports blocked. */
function block(type, id, req) {
  const { info, item } = findItem(type, id);
  db.transaction(() => {
    db.prepare(`UPDATE ${info.table} SET isBlocked = 1, isQuarantined = 0 WHERE id = ?`).run(id);
    Report.resolvePending(type, id, Report.STATUSES.BLOCKED, reviewerId(req));
  })();
  logSecurity(action('BLOCK', type), req, type, id, pathOf(info, item), { via: 'moderation' });
}

/** Lift the quarantine and dismiss the pending reports. */
function clear(type, id, req) {
  const { info, item } = findItem(type, id);
  db.transaction(() => {
    db.prepare(`UPDATE ${info.table} SET isQuarantined = 0 WHERE id = ?`).run(id);
    Report.resolvePending(type, id, Report.STATUSES.DISMISSED, reviewerId(req));
  })();
  logSecurity(ACTIONS.CLEAR_QUARANTINE, req, type, id, pathOf(info, item), {});
}

/**
 * Block or unblock the item a single report is about, and mark that report
 * blocked (or reviewed after an unblock).
 */
function setBlockedFromReport(report, blocked, req) {
  const { info, item } = findItem(report.targetType, report.targetId);
  db.transaction(() => {
    db.prepare(`UPDATE ${info.table} SET isBlocked = ?${blocked ? ', isQuarantined = 0' : ''} WHERE id = ?`)
      .run(blocked ? 1 : 0, item.id);
    Report.updateStatus(report.id, blocked ? Report.STATUSES.BLOCKED : Report.STATUSES.REVIEWED, reviewerId(req));
  })();
  logAdminAction(action(blocked ? 'BLOCK' : 'UNBLOCK', report.targetType), req, report.targetType, item.id,
    pathOf(info, item), { reportId: report.id, reason: report.reason });
}

/**
 * Ban the owner of a reported item and block everything they own (every type).
 * @param {number} userId - must be the item's owner (a guard against acting on a stale page)
 * @returns {{ username: string, blocked: object }} blocked counts per type
 */
function banOwnerFromReport(report, userId, req) {
  const { info, item } = findItem(report.targetType, report.targetId);
  const ownerId = item[info.ownerColumn];
  if (!ownerId || ownerId !== userId) throw new ModerationError('User ID does not match the owner', 400);
  const user = User.findById(ownerId);
  if (!user) throw new ModerationError('User not found', 404);

  const blocked = {};
  db.transaction(() => {
    db.prepare('UPDATE users SET isBanned = 1 WHERE id = ?').run(ownerId);
    for (const [type, typeInfo] of Object.entries(CONTENT_TYPES)) {
      blocked[type] = db.prepare(`UPDATE ${typeInfo.table} SET isBlocked = 1 WHERE ${typeInfo.ownerColumn} = ?`)
        .run(ownerId).changes;
    }
    Report.updateStatus(report.id, Report.STATUSES.BLOCKED, reviewerId(req));
  })();

  logAdminAction(ACTIONS.BAN_USER, req, 'user', ownerId, user.username, {
    source: 'report_review',
    reportId: report.id,
    targetType: report.targetType,
    targetId: report.targetId,
    reason: report.reason,
    blocked
  });
  return { username: user.username, blocked };
}

/** Quarantined items of every type, most reported first, for the top of Admin → Reports. */
function listQuarantined() {
  const items = [];
  for (const [type, info] of Object.entries(CONTENT_TYPES)) {
    if (!info.quarantine) continue;
    const rows = db.prepare(`
      SELECT t.id, t.slug, t.${info.destination} AS target, t.${info.ownerColumn} AS ownerId,
             (SELECT COUNT(*) FROM reports r
              WHERE r.targetType = ? AND r.targetId = t.id AND r.status = 'pending') AS pendingReports,
             (SELECT GROUP_CONCAT(DISTINCT r.reason) FROM reports r
              WHERE r.targetType = ? AND r.targetId = t.id AND r.status = 'pending') AS reasons
      FROM ${info.table} t
      WHERE t.isQuarantined = 1
    `).all(type, type);
    for (const row of rows) {
      items.push({ type, ...row, path: `${info.publicPrefix}${row.slug}`, reasons: row.reasons ? row.reasons.split(',') : [] });
    }
  }
  return items.sort((a, b) => b.pendingReports - a.pendingReports);
}

module.exports = {
  afterReport, block, clear, setBlockedFromReport, banOwnerFromReport, listQuarantined, ModerationError
};
