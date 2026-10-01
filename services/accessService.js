const { contentType } = require('./contentTypes');
const { canView } = require('./itemPermissions');
const unlocks = require('./unlockService');

/**
 * One access check for every content type (links, bundles, pastes, files).
 *
 * Statuses, in the order they are checked:
 *   blocked → scheduled → expired → limit_reached → quarantined
 *   → login_required / forbidden (restricted files) → password_required → active
 *
 * The first five depend on the record alone (recordStatus). statusSql() computes
 * the same five in SQL for list filters; a test keeps the two in step. The rest
 * depend on the visitor (session, login) and only exist in evaluate().
 *
 * Dates without a timezone ("2026-06-15T12:30", "2026-06-15 12:30:00") are UTC,
 * as SQLite reads them.
 */

// Statuses where the record itself can't be opened by anyone
const UNAVAILABLE = ['blocked', 'scheduled', 'expired', 'limit_reached'];

const ZONELESS = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

/** Milliseconds since the epoch, or null for an empty or unreadable date. */
function toTime(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.getTime();
  const text = String(value).trim();
  const time = Date.parse(ZONELESS.test(text) ? `${text.replace(' ', 'T')}Z` : text);
  return Number.isNaN(time) ? null : time;
}

/**
 * Status from the record alone: blocked, scheduled, expired, limit_reached,
 * quarantined or active.
 */
function recordStatus(type, record, now = new Date()) {
  const info = contentType(type);
  const nowTime = toTime(now);

  if (record.isBlocked) return 'blocked';

  const activateAt = toTime(record.activateAt);
  if (activateAt !== null && activateAt > nowTime) return 'scheduled';

  const deactivateAt = toTime(record.deactivateAt);
  const expiresAt = toTime(record.expiresAt);
  if ((deactivateAt !== null && deactivateAt < nowTime) || (expiresAt !== null && expiresAt < nowTime)) {
    return 'expired';
  }

  const limit = record[info.limitColumn];
  if (limit !== null && limit !== undefined && (record[info.usedColumn] || 0) >= limit) return 'limit_reached';

  if (info.quarantine && record.isQuarantined) return 'quarantined';

  return 'active';
}

function allowedUserIds(record) {
  if (Array.isArray(record.allowedUsers)) return record.allowedUsers;
  try {
    const ids = JSON.parse(record.allowedUsers || '[]');
    return Array.isArray(ids) ? ids : [];
  } catch (_) {
    return [];
  }
}

/** For restricted files: null when the user may open it, otherwise the status. */
function restrictedStatus(type, info, record, user) {
  if (!info.restricted || record.sharingMode !== 'restricted') return null;
  if (!user) return 'login_required';
  if (canView(user, type, record) || allowedUserIds(record).includes(user.id)) return null;
  return 'forbidden';
}

/**
 * The full check.
 * @param {object} ctx - { now, user, unlocked, quarantineAck }
 * @returns {{ status: string, allowed: boolean }}
 */
function evaluate(type, record, ctx = {}) {
  const info = contentType(type);
  const result = (status) => ({ status, allowed: status === 'active' });

  const status = recordStatus(type, record, ctx.now || new Date());
  if (UNAVAILABLE.includes(status)) return result(status);
  if (status === 'quarantined' && !ctx.quarantineAck) return result(status);

  const restricted = restrictedStatus(type, info, record, ctx.user || null);
  if (restricted) return result(restricted);

  if (record.password && !ctx.unlocked) return result('password_required');

  return result('active');
}

/** Whether the record itself is available (it may still ask for a password or show a warning). */
function isLive(status) {
  return !UNAVAILABLE.includes(status);
}

/**
 * SQL CASE expression giving recordStatus() for rows of `type`.
 * @param {object} options - { alias (default: the table name), now (default: current time) }
 * @returns {{ sql: string, params: string[] }}
 */
function statusSql(type, { alias, now } = {}) {
  const info = contentType(type);
  const t = alias || info.table;
  const at = `julianday(?)`;
  const nowIso = new Date(toTime(now || new Date())).toISOString();

  const sql = `CASE
    WHEN COALESCE(${t}.isBlocked, 0) <> 0 THEN 'blocked'
    WHEN julianday(${t}.activateAt) > ${at} THEN 'scheduled'
    WHEN julianday(${t}.deactivateAt) < ${at} OR julianday(${t}.expiresAt) < ${at} THEN 'expired'
    WHEN ${t}.${info.limitColumn} IS NOT NULL AND COALESCE(${t}.${info.usedColumn}, 0) >= ${t}.${info.limitColumn} THEN 'limit_reached'
    ${info.quarantine ? `WHEN COALESCE(${t}.isQuarantined, 0) <> 0 THEN 'quarantined'` : ''}
    ELSE 'active'
  END`;

  return { sql, params: [nowIso, nowIso, nowIso] };
}

/** Visitor-facing message for a status. */
function message(type, status) {
  const { noun } = contentType(type);
  switch (status) {
    case 'blocked': return `This ${noun} has been blocked.`;
    case 'scheduled': return `This ${noun} is not active yet.`;
    case 'expired': return `This ${noun} has expired.`;
    case 'limit_reached': return `This ${noun} has reached its usage limit.`;
    case 'quarantined': return `This ${noun} has been reported by several visitors.`;
    case 'login_required': return `Log in to access this ${noun}.`;
    case 'forbidden': return `You do not have permission to access this ${noun}.`;
    case 'password_required': return `This ${noun} is password protected.`;
    default: return null;
  }
}

/**
 * evaluate() with the context read from the request: the logged-in user, unlocks
 * in the session, and "Continue anyway" (?confirmed=1) on a quarantine warning,
 * which is remembered in req.session.quarantineAck. A one-time unlock is used up
 * once it lets the visitor through.
 */
function checkAccess(req, type, record) {
  const info = contentType(type);
  const session = req.session || {};

  let quarantineAck = false;
  if (info.quarantine && record.isQuarantined) {
    const key = `${type}:${record.id}`;
    const acknowledged = session.quarantineAck || [];
    if (req.query && req.query.confirmed === '1') {
      if (!acknowledged.includes(key)) session.quarantineAck = [...acknowledged, key];
      quarantineAck = true;
    } else {
      quarantineAck = acknowledged.includes(key);
    }
  }

  const unlocked = unlocks.isRemembered(session, type, record.id) || unlocks.isOnce(session, type, record.id);
  const result = evaluate(type, record, { user: req.user || null, unlocked, quarantineAck });
  if (result.allowed) unlocks.useOnce(session, type, record.id);
  return result;
}

/** Send the response for a refused result: an error page, a warning or a redirect. */
function sendAccessDenied(req, res, type, record, result) {
  const info = contentType(type);
  const { status } = result;
  const text = message(type, status);
  const noun = info.noun.charAt(0).toUpperCase() + info.noun.slice(1);
  const user = req.user || null;

  switch (status) {
    case 'password_required':
      return res.redirect(`/unlock/${type}/${record.slug}`);
    case 'login_required':
      return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl || `${info.publicPrefix}${record.slug}`)}`);
    case 'quarantined':
      return res.render('quarantine', {
        user,
        kind: info.noun,
        destination: record[info.destination],
        continueUrl: `${info.publicPrefix}${record.slug}?confirmed=1`,
        infoUrl: info.infoPrefix ? `${info.infoPrefix}${record.slug}` : null
      });
    case 'scheduled':
      return res.status(404).render('scheduled', {
        user,
        title: 'Not Yet Active',
        message: text,
        activateAt: record.activateAt,
        deactivateAt: record.deactivateAt,
        path: `${info.publicPrefix}${record.slug}`,
        code: 404
      });
    case 'blocked':
      return res.status(403).render('error', { user, title: `${noun} Blocked`, message: text, code: 403 });
    case 'forbidden':
      return res.status(403).render('error', { user, title: 'Access Denied', message: text, code: 403 });
    default:
      return res.status(410).render('error', { user, title: `${noun} Unavailable`, message: text, code: 410 });
  }
}

/**
 * For pages that come before the full check (the unlock pages): refuse a record
 * that is unavailable to everyone.
 * @returns {boolean} true when a response was sent (the caller stops)
 */
function sendIfUnavailable(req, res, type, record) {
  const status = recordStatus(type, record);
  if (isLive(status)) return false;
  sendAccessDenied(req, res, type, record, { status, allowed: false });
  return true;
}

/** Rows for list pages, each with its accessStatus (the templates show it as a badge). */
function withAccessStatus(type, rows) {
  const now = new Date();
  return rows.map(row => ({ ...row, accessStatus: recordStatus(type, row, now) }));
}

module.exports = {
  recordStatus, evaluate, isLive, statusSql, message, checkAccess, sendAccessDenied, sendIfUnavailable,
  withAccessStatus, toTime
};
