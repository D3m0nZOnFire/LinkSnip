const { contentType } = require('./contentTypes');

/**
 * Password unlocks in the session, the same for every content type:
 *   session.unlocked   = { url: [ids], bundle: [ids], paste: [ids], file: [ids] }  (remembered)
 *   session.unlockOnce = { type, id }                                             (next visit only)
 * Bundles are always remembered: the item links on their launcher (/bt) need the
 * unlock to last.
 */

function isRemembered(session, type, id) {
  return !!(session && session.unlocked && (session.unlocked[type] || []).includes(id));
}

function isOnce(session, type, id) {
  const once = session && session.unlockOnce;
  return !!once && once.type === type && once.id === id;
}

/** Record a successful unlock. */
function grant(session, type, id, remember) {
  if (remember || contentType(type).alwaysRemember) {
    const unlocked = session.unlocked || {};
    const ids = unlocked[type] || [];
    session.unlocked = { ...unlocked, [type]: ids.includes(id) ? ids : [...ids, id] };
  } else {
    session.unlockOnce = { type, id };
  }
}

/** Use up a one-time unlock once it let the visitor through. */
function useOnce(session, type, id) {
  if (isOnce(session, type, id)) delete session.unlockOnce;
}

module.exports = { isRemembered, isOnce, grant, useOnce };
