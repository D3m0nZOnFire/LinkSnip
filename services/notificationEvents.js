/**
 * What can be notified (services/notificationService.js). Each event:
 *   group       section on Settings → Notifications
 *   label       its line there ("An item is blocked")
 *   defaults    { inApp, mail } for a user who changed nothing: in-app for everything, mail for what needs action
 *   toggleable  false: the user can't turn it off (the ban notice)
 *   immediate   mailed at the next run, not after notifications.mailDelayMinutes
 *   text(p)     the sentence shown and mailed, from the stored payload
 *   path(p)     where it links (null: nowhere, e.g. a deleted item)
 * Payloads keep what the text needs, so it still reads after the item is gone: `item` { type, noun, slug, address,
 * path } (notificationService.itemPayload), `team` { id, name }, `role`, `by`, `days`, `limit`, `unit`.
 */

const GROUPS = [
  { id: 'moderation', label: 'Reports and moderation' },
  { id: 'lifecycle', label: 'Expiry, limits and cleanup' },
  { id: 'teams', label: 'Teams' },
  { id: 'account', label: 'Account' }
];

const your = (p) => `Your ${p.item.noun} ${p.item.address}`;
const itemPath = (p) => (p.item && p.item.path) || null;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const EVENTS = {
  report_received: {
    group: 'moderation', label: 'Someone reports one of my items', mail: false,
    text: (p) => `Someone reported ${your(p).replace(/^Your/, 'your')}. An administrator will look at it.`,
    path: itemPath
  },
  quarantined: {
    group: 'moderation', label: 'An item is quarantined after reports', mail: true,
    text: (p) => `${your(p)} was quarantined after reports: visitors see a warning before they can open it, until an administrator reviews it.`,
    path: itemPath
  },
  quarantine_cleared: {
    group: 'moderation', label: 'A quarantine is lifted', mail: false,
    text: (p) => `The warning on ${your(p).replace(/^Your/, 'your')} was lifted: visitors open it directly again.`,
    path: itemPath
  },
  blocked: {
    group: 'moderation', label: 'An item is blocked by an administrator', mail: true,
    text: (p) => `${your(p)} was blocked by an administrator. Visitors can no longer open it.`,
    path: itemPath
  },
  unblocked: {
    group: 'moderation', label: 'An item is unblocked', mail: false,
    text: (p) => `${your(p)} was unblocked: visitors can open it again.`,
    path: itemPath
  },
  account_banned: {
    group: 'account', label: 'My account is suspended', toggleable: false, immediate: true,
    defaults: { inApp: false, mail: true },
    text: () => "Your account was suspended by an administrator: you can't log in any more, and your links, bundles, pastes and files no longer open.",
    path: () => null
  },
  expires_soon: {
    group: 'lifecycle', label: 'An item expires soon', mail: true,
    text: (p) => `${your(p)} expires in ${plural(p.days, 'day')}.`,
    path: itemPath
  },
  expired: {
    group: 'lifecycle', label: 'An item has expired', mail: true,
    text: (p) => `${your(p)} has expired. ${p.days > 0
      ? `It will be deleted in ${plural(p.days, 'day')}, unless you give it a new expiry date.`
      : 'It will be deleted tonight.'}`,
    path: itemPath
  },
  limit_reached: {
    group: 'lifecycle', label: 'An item reaches its usage limit', mail: true,
    text: (p) => `${your(p)} reached its limit${p.limit ? ` of ${plural(p.limit, (p.unit || 'uses').replace(/s$/, ''))}` : ''}: visitors can no longer open it.`,
    path: itemPath
  },
  deleted_by_cleanup: {
    group: 'lifecycle', label: 'An expired item is deleted', mail: false,
    text: (p) => `${your(p).replace(/^Your/, 'Your expired')} was deleted.`,
    path: () => null
  },
  team_invited: {
    group: 'teams', label: 'I am invited to a team', mail: true,
    text: (p) => `${p.by ? `${p.by} invited you` : 'You were invited'} to the team ${p.team.name} as ${p.role}.`,
    path: () => '/dashboard'
  },
  team_role_changed: {
    group: 'teams', label: 'My role in a team changes', mail: false,
    text: (p) => `Your role in the team ${p.team.name} is now ${p.role}.`,
    path: (p) => `/teams/${p.team.id}`
  },
  team_removed: {
    group: 'teams', label: 'I am removed from a team', mail: false,
    text: (p) => `You were removed from the team ${p.team.name}.`,
    path: () => null
  },
  team_deleted: {
    group: 'teams', label: 'A team I am in is deleted', mail: false,
    text: (p) => `The team ${p.team.name} was deleted, with its links, bundles, pastes and files.`,
    path: () => null
  }
};

for (const spec of Object.values(EVENTS)) {
  if (!spec.defaults) spec.defaults = { inApp: true, mail: !!spec.mail };
  if (spec.toggleable === undefined) spec.toggleable = true;
  spec.immediate = !!spec.immediate;
  delete spec.mail;
  Object.freeze(spec);
}
Object.freeze(EVENTS);

/** The event's spec, or null (own keys only: "constructor" is not an event). */
function event(name) {
  return typeof name === 'string' && Object.hasOwn(EVENTS, name) ? EVENTS[name] : null;
}

/** Events a user can turn on and off, in registry order. */
function toggleableEvents() {
  return Object.keys(EVENTS).filter(name => EVENTS[name].toggleable);
}

/** { text, path } for a stored notification. */
function describe(name, payload = {}) {
  const spec = event(name);
  if (!spec) return { text: 'Notification', path: null };
  try {
    return { text: spec.text(payload), path: spec.path(payload) };
  } catch {
    // A payload from an older version that lacks something the text needs
    return { text: spec.label, path: null };
  }
}

module.exports = { EVENTS, GROUPS, event, toggleableEvents, describe };
