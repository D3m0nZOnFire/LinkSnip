const bcrypt = require('bcrypt');
const configService = require('./configService');
const { contentType } = require('./contentTypes');
const { toTime } = require('./accessService');
const slugService = require('./slugService');

/**
 * The settings every content type has (expiry, schedule, usage limit, password),
 * read from a create or update request the same way for all of them.
 *
 *   Create: every setting is returned (null when not sent). Anonymous items get the
 *   type's expiry cap (anonymous.*ExpirationDays).
 *   Update: only settings that are sent are returned. An empty value removes the
 *   setting, a new one replaces it. The stored value sent back unchanged counts as
 *   unchanged: the paste and file forms show the expiry as a date only.
 *   Password: '' or absent keeps it (password fields are never filled in); null or
 *   removePassword removes it. Stored trimmed.
 *
 * Slug: on create the chosen one, or a random one when none is chosen. On update a different one replaces it
 *   (only its case is enough); absent, empty or the stored one sent back keeps it. Checked through slugService.
 *
 * Fields accepted, as the forms and APIs send them:
 *   expiry     expirationDays (days from now) or expiresAt (a date)
 *   schedule   activateDateTime or activateAt, deactivateDateTime or deactivateAt
 *   limit      maxUses, maxViews or maxDownloads (the type's own column)
 *   slug       slug or customSlug
 * Dates without a timezone are UTC; everything is stored as ISO UTC.
 */

class SettingsError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const DAY = 24 * 60 * 60 * 1000;
const sent = (body, key) => Object.prototype.hasOwnProperty.call(body, key);
const empty = (value) => value === undefined || value === null || String(value).trim() === '';
const isoAt = (time) => new Date(time).toISOString();
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(value, label) {
  const time = toTime(String(value).trim());
  if (time === null) throw new SettingsError(`Invalid ${label} date: "${value}"`);
  return isoAt(time);
}

function positiveInteger(value, label) {
  const text = String(value).trim();
  if (!/^\d+$/.test(text) || Number(text) < 1) throw new SettingsError(`${label} must be a whole number of at least 1`);
  return Number(text);
}

/** The first of `names` present in the body, as [name, value], or null. */
function field(body, names) {
  const name = names.find(n => sent(body, n));
  return name ? [name, body[name]] : null;
}

function readExpiry(body, existing) {
  const days = field(body, ['expirationDays']);
  if (days) {
    if (empty(days[1]) || String(days[1]).trim() === '0') return { value: null };
    const n = Number(String(days[1]).trim());
    if (!Number.isInteger(n) || n < 1) throw new SettingsError('Expiry days must be a whole number of at least 1');
    return { value: isoAt(Date.now() + n * DAY) };
  }
  const date = field(body, ['expiresAt']);
  if (!date) return null;
  if (empty(date[1])) return { value: null };
  const text = String(date[1]).trim();
  // The paste and file forms show the stored expiry as a date: that day sent back means unchanged
  if (existing && existing.expiresAt && DATE_ONLY.test(text) && toTime(existing.expiresAt) !== null &&
      isoAt(toTime(existing.expiresAt)).startsWith(text)) {
    return { unchanged: true };
  }
  return { value: parseDate(text, 'expiry') };
}

const SLUG_FIELDS = ['slug', 'customSlug'];

/** { value, chosen } for the slug to store, or null on update when it stays. */
function readSlug(type, body, existing) {
  const found = field(body, SLUG_FIELDS);
  const requested = found && !empty(found[1]) ? String(found[1]).trim() : null;
  if (existing && (requested === null || requested === existing.slug)) return null;
  try {
    return { value: slugService.resolve(type, requested, { exceptId: existing ? existing.id : null }), chosen: requested !== null };
  } catch (error) {
    if (error instanceof slugService.SlugError) throw new SettingsError(error.message);
    throw error;
  }
}

/**
 * @param {string} type - content type
 * @param {object} body - the request body
 * @param {object} options - { user (null = anonymous), existing (the stored item, on update) }
 * @returns {Promise<{ values: object, uses: { passwordProtection: boolean, scheduling: boolean, customSlugs: boolean } }>}
 *   values: columns to store. uses: role-gated features the request newly sets.
 * @throws {SettingsError} for a value that can't be read (status 400)
 */
async function readSettings(type, body = {}, { user = null, existing = null } = {}) {
  const info = contentType(type);
  const creating = !existing;
  const values = {};
  const uses = { passwordProtection: false, scheduling: false, customSlugs: false };

  // Expiry, with the anonymous cap on create
  const expiry = readExpiry(body, existing);
  if (expiry && !expiry.unchanged) values.expiresAt = expiry.value;
  if (creating) {
    if (values.expiresAt === undefined) values.expiresAt = null;
    const capSetting = info.anonymousExpirySetting;
    if (!user && capSetting) {
      const cap = Date.now() + configService.get(capSetting) * DAY;
      if (values.expiresAt === null || toTime(values.expiresAt) > cap) values.expiresAt = isoAt(cap);
    }
  }

  // Schedule
  for (const [column, names, label] of [
    ['activateAt', ['activateDateTime', 'activateAt'], 'activation'],
    ['deactivateAt', ['deactivateDateTime', 'deactivateAt'], 'deactivation']
  ]) {
    const found = field(body, names);
    if (!found) {
      if (creating) values[column] = null;
      continue;
    }
    const value = empty(found[1]) ? null : parseDate(found[1], label);
    const stored = existing && existing[column] ? isoAt(toTime(existing[column])) : null;
    if (!creating && value === stored) continue;
    values[column] = value;
    if (value !== null) uses.scheduling = true;
  }

  // Usage limit (maxUses / maxViews / maxDownloads)
  const limit = field(body, [info.limitColumn]);
  if (limit) values[info.limitColumn] = empty(limit[1]) ? null : positiveInteger(limit[1], 'The usage limit');
  else if (creating) values[info.limitColumn] = null;

  // Password
  const remove = [true, 'true', '1'].includes(body.removePassword) || (sent(body, 'password') && body.password === null);
  if (remove) {
    if (!creating) values.password = null;
  } else if (!empty(body.password)) {
    values.password = await bcrypt.hash(String(body.password).trim(), 10);
    uses.passwordProtection = true;
  }
  if (creating && values.password === undefined) values.password = null;

  // Slug, checked last: nothing is awaited between this check and the caller's insert or update
  const slug = readSlug(type, body, existing);
  if (slug) {
    values.slug = slug.value;
    uses.customSlugs = slug.chosen;
  }

  return { values, uses };
}

module.exports = { readSettings, SettingsError };
