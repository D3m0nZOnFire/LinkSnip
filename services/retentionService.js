const configService = require('./configService');
const { contentType } = require('./contentTypes');
const { toTime } = require('./accessService');

/**
 * When the nightly cleanup deletes an expired item, for the "Deletes in N days"
 * warning. Same rule as Url/Paste.deleteInactiveRegistered: a registered user's
 * item is deleted retention.expiredGraceDays after the earlier of its past
 * expiresAt / deactivateAt. Anonymous items go as soon as they expire, so they
 * get no warning.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const WARN_WITHIN_DAYS = 30;

/**
 * Days left before deletion, or null when there is nothing to warn about
 * (not expired, anonymous, more than 30 days left, or due tonight).
 */
function deletesInDays(type, record, now = new Date()) {
  if (!record[contentType(type).ownerColumn]) return null;

  const nowTime = toTime(now);
  const inactiveSince = [toTime(record.expiresAt), toTime(record.deactivateAt)]
    .filter(time => time !== null && time < nowTime);
  if (inactiveSince.length === 0) return null;

  const graceDays = configService.get('retention.expiredGraceDays');
  const remaining = graceDays - (nowTime - Math.min(...inactiveSince)) / DAY_MS;
  return remaining > 0 && remaining <= WARN_WITHIN_DAYS ? Math.ceil(remaining) : null;
}

module.exports = { deletesInDays };
