const crypto = require('crypto');
const db = require('../config/database');
const Notification = require('../models/Notification');
const configService = require('./configService');
const mailService = require('./mailService');
const mailTemplates = require('./mailTemplates');
const events = require('./notificationEvents');
const { contentType } = require('./contentTypes');
const { isEnabled: isFeatureEnabled } = require('../middleware/requireFeature');

/**
 * Notifications: an event for a user becomes one row, shown on /notifications (inApp) and, when the user wants
 * mail for it and has a confirmed address, queued for a mail (mailState 'pending'). sendDue() runs every minute:
 * a user's pending rows go out together once the first is due (notifications.mailDelayMinutes; immediate events at
 * once), and rows the user already saw on /notifications are left out of the mail ('skipped').
 * Nobody is told about their own action, banned users only about the ban, and nothing here throws into a request.
 */

const OLD_AFTER_DAYS = 30;
const UNSUBSCRIBE_ALL = 'all';

const userRow = (userId) => db.prepare(
  'SELECT id, username, email, emailVerifiedAt, isBanned, notificationKey FROM users WHERE id = ?'
).get(userId);

const canMail = (user) => mailService.isEnabled() && !!user.email && !!user.emailVerifiedAt;

/** { event: { inApp, mail } } for every toggleable event: the defaults with the user's changes over them. */
function preferences(userId) {
  const stored = new Map(db.prepare('SELECT event, inApp, mail FROM notification_preferences WHERE userId = ?')
    .all(userId).map(r => [r.event, { inApp: !!r.inApp, mail: !!r.mail }]));
  return Object.fromEntries(events.toggleableEvents().map(name =>
    [name, stored.get(name) || { ...events.event(name).defaults }]));
}

/**
 * Stores the changes in `changes` ({ event: { inApp?, mail? } }); unknown and fixed events are ignored.
 */
function setPreferences(userId, changes) {
  const current = preferences(userId);
  const upsert = db.prepare(`
    INSERT INTO notification_preferences (userId, event, inApp, mail) VALUES (?, ?, ?, ?)
    ON CONFLICT (userId, event) DO UPDATE SET inApp = excluded.inApp, mail = excluded.mail
  `);
  db.transaction(() => {
    for (const [name, change] of Object.entries(changes || {})) {
      const spec = events.event(name);
      if (!spec || !spec.toggleable || !change || typeof change !== 'object') continue;
      const next = { ...current[name] };
      if (typeof change.inApp === 'boolean') next.inApp = change.inApp;
      if (typeof change.mail === 'boolean') next.mail = change.mail;
      upsert.run(userId, name, next.inApp ? 1 : 0, next.mail ? 1 : 0);
    }
  })();
}

/** Settings → Notifications: the toggleable events by group, with the user's choices. */
function preferenceGroups(userId) {
  const prefs = preferences(userId);
  return events.GROUPS
    .map(group => ({
      id: group.id,
      label: group.label,
      events: Object.keys(prefs).filter(name => events.event(name).group === group.id)
        .map(name => ({ name, label: events.event(name).label, ...prefs[name] }))
    }))
    .filter(group => group.events.length > 0);
}

/** What a user wants for an event: { inApp, mail }. */
function wants(userId, name) {
  const spec = events.event(name);
  return spec.toggleable ? preferences(userId)[name] : { ...spec.defaults };
}

/**
 * Records an event for a user.
 * @param {{ type?: string, id?: number, payload?: object, actorId?: number, dedupeKey?: string }} options
 * @returns {object|null} The stored row, or null when nothing was stored
 */
function notify(userId, name, { type = null, id = null, payload = {}, actorId = null, dedupeKey = null } = {}) {
  try {
    if (!userId || !isFeatureEnabled('notifications')) return null;
    const spec = events.event(name);
    if (!spec || (actorId !== null && actorId !== undefined && Number(actorId) === Number(userId))) return null;
    const user = userRow(userId);
    if (!user || (user.isBanned && name !== 'account_banned')) return null;

    const wanted = wants(userId, name);
    const mail = wanted.mail && canMail(user);
    if (!wanted.inApp && !mail) return null;

    const delayMinutes = spec.immediate ? 0 : configService.get('notifications.mailDelayMinutes');
    return Notification.create({
      userId, event: name, targetType: type, targetId: id, payload, inApp: wanted.inApp,
      mailState: mail ? 'pending' : 'none',
      mailAfter: mail ? new Date(Date.now() + delayMinutes * 60000).toISOString() : null,
      dedupeKey
    });
  } catch (error) {
    console.error(`Notification ${name} for user ${userId} failed: ${error.message}`);
    return null;
  }
}

/** The item as stored in a payload. `deleted`: no link (the item is going away). */
function itemPayload(type, item, { deleted = false } = {}) {
  const info = contentType(type);
  const address = `${info.publicPrefix}${item.slug}`;
  return {
    type, noun: info.noun, slug: item.slug, address,
    path: deleted ? null : (info.infoPrefix ? `${info.infoPrefix}${item.slug}` : address)
  };
}

/**
 * Tells an item's owner (the registry's ownerColumn) about it. Anonymous items have nobody to tell.
 * @param {{ payload?: object, actorId?: number, dedupe?: boolean|string, deleted?: boolean }} options
 */
function notifyItemOwner(type, item, name, { payload = {}, actorId = null, dedupe = false, deleted = false } = {}) {
  try {
    const ownerId = item && item[contentType(type).ownerColumn];
    if (!ownerId) return null;
    // dedupe: once per event and item; a string adds what makes a new occurrence (a new expiry date, a new limit)
    let dedupeKey = null;
    if (dedupe) dedupeKey = `${name}:${type}:${item.id}${typeof dedupe === 'string' ? `:${dedupe}` : ''}`;
    else if (name === 'limit_reached') dedupeKey = `${name}:${type}:${item.id}:${payload.limit}`;
    return notify(ownerId, name, {
      type, id: item.id, actorId,
      payload: { item: itemPayload(type, item, { deleted }), ...payload },
      dedupeKey
    });
  } catch (error) {
    console.error(`Notification ${name} for ${type} ${item && item.id} failed: ${error.message}`);
    return null;
  }
}

/**
 * After a click, view or download was counted: tells the owner when the item reached its usage limit. Once per
 * limit (raising the limit and reaching it again tells them again).
 */
function afterUse(type, id) {
  try {
    const info = contentType(type);
    const item = db.prepare(`SELECT * FROM ${info.table} WHERE id = ?`).get(id);
    const limit = item && item[info.limitColumn];
    if (!limit || item[info.usedColumn] < limit) return null;
    const row = notifyItemOwner(type, item, 'limit_reached', { payload: { limit, unit: info.eventLabel.toLowerCase() } });
    return row;
  } catch (error) {
    console.error(`Usage limit notification for ${type} ${id} failed: ${error.message}`);
    return null;
  }
}

/** A quarantine replaces the report notices of that item that weren't read or mailed yet. */
function dropReportNotices(type, id) {
  return Notification.deleteUnsent('report_received', type, id);
}

// ─── Unsubscribe links ─────────────────────────────────────────────────────────

/** The user's random key for unsubscribe links, made on first use. */
function notificationKey(userId) {
  const user = userRow(userId);
  if (user.notificationKey) return user.notificationKey;
  const key = crypto.randomBytes(24).toString('base64url');
  db.prepare('UPDATE users SET notificationKey = ? WHERE id = ? AND notificationKey IS NULL').run(key, userId);
  return userRow(userId).notificationKey;
}

const isUnsubscribable = (name) => name === UNSUBSCRIBE_ALL || (!!events.event(name) && events.event(name).toggleable);

function unsubscribeUrl(userId, name) {
  return mailService.link(`/notifications/unsubscribe/${notificationKey(userId)}/${name}`);
}

/** @returns {{ userId, username, event }|null} What an unsubscribe link stands for */
function findUnsubscribe(key, name) {
  if (typeof key !== 'string' || !key || !isUnsubscribable(name)) return null;
  const user = db.prepare('SELECT id, username FROM users WHERE notificationKey = ?').get(key);
  return user ? { userId: user.id, username: user.username, event: name } : null;
}

/** Turns the mail of that event (or of every event: 'all') off. @returns {boolean} whether the link was valid */
function unsubscribe(key, name) {
  const found = findUnsubscribe(key, name);
  if (!found) return false;
  const names = name === UNSUBSCRIBE_ALL ? events.toggleableEvents() : [name];
  setPreferences(found.userId, Object.fromEntries(names.map(n => [n, { mail: false }])));
  return true;
}

// ─── Mail ──────────────────────────────────────────────────────────────────────

let sending = false;

/**
 * Sends the mails that are due (scheduled every minute). One mail per user with all their pending rows, minus those
 * seen in the app, those whose mail was turned off meanwhile and, for a banned user, everything but the ban.
 * A failed mail keeps its rows pending for the next run.
 * @param {Date} [at] now
 * @returns {Promise<number>} mails sent
 */
async function sendDue(at = new Date()) {
  if (sending) return 0;
  sending = true;
  try {
    if (!mailService.isEnabled() || !isFeatureEnabled('notifications')) {
      Notification.skipAllPending();
      return 0;
    }
    let sent = 0;
    for (const userId of Notification.usersDueForMail(at)) {
      if (await mailUser(userId)) sent++;
    }
    return sent;
  } finally {
    sending = false;
  }
}

async function mailUser(userId) {
  const user = userRow(userId);
  const rows = Notification.pendingForUser(userId);
  const prefs = preferences(userId);
  const keep = (row) => !row.readAt && (row.event === 'account_banned' || (!user.isBanned &&
    (!events.event(row.event) || !events.event(row.event).toggleable || prefs[row.event].mail)));
  const toSend = canMail(user) ? rows.filter(keep) : [];
  Notification.setMailState(rows.filter(row => !toSend.includes(row)).map(row => row.id), 'skipped');
  if (toSend.length === 0) return false;

  const names = [...new Set(toSend.map(row => row.event))];
  const headerEvent = names.length === 1 && isUnsubscribable(names[0]) ? names[0] : UNSUBSCRIBE_ALL;
  const items = toSend.map(row => {
    const { text, path } = events.describe(row.event, row.payload);
    return {
      text,
      url: path ? mailService.link(path) : null,
      unsubscribe: isUnsubscribable(row.event) ? unsubscribeUrl(userId, row.event) : null
    };
  });
  const { mailContext } = require('./accountEmail');
  const mail = mailTemplates.notifications({
    ...mailContext(), username: user.username, items,
    pageUrl: user.isBanned ? null : mailService.link('/notifications'),
    settingsUrl: user.isBanned ? null : mailService.link('/settings#notifications')
  });
  const unsubscribe = unsubscribeUrl(userId, headerEvent);

  try {
    await mailService.send({
      to: user.email, ...mail,
      headers: { 'List-Unsubscribe': `<${unsubscribe}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
    });
  } catch (error) {
    console.error(`Notification mail to ${user.email} failed (will retry): ${error.message}`);
    return false;
  }
  Notification.setMailState(toSend.map(row => row.id), 'sent');
  return true;
}

/** Nightly: rows read more than 30 days ago, and finished mail-only rows. @returns {number} rows deleted */
function cleanup() {
  return Notification.deleteOld(OLD_AFTER_DAYS);
}

module.exports = {
  notify, notifyItemOwner, itemPayload, afterUse, dropReportNotices, preferences, setPreferences, preferenceGroups,
  unsubscribeUrl, findUnsubscribe, unsubscribe, sendDue, cleanup, UNSUBSCRIBE_ALL, OLD_AFTER_DAYS
};
