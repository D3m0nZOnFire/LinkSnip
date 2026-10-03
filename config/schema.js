/**
 * Single source of truth for every setting, permission and limit.
 *
 * The descriptions here drive the validator (services/configService.js), the
 * Admin → Settings help text and the generated docs/CONFIGURATION.md, so they
 * can't drift apart. Add a key here and it exists everywhere.
 */

// ─── settings.json ────────────────────────────────────────────────────────────
// Keys are dotted paths into the nested JSON file. `env` names a legacy env var
// carried over once, when settings.json is first created.
const SETTINGS = {
  'access.loginRequired': {
    type: 'boolean', default: false,
    description: 'Private instance: only people with an account can open anything. Visitors are sent to the login page from every short link, paste, file, bundle, info page, QR code and bio page. Analytics share links (/stats/…) need an account too, so they are effectively off. Usually combined with registration.open false, so that admins create the accounts.'
  },
  'registration.open': {
    type: 'boolean', default: true,
    description: 'Anyone can create an account. When false, only admins can create accounts.'
  },
  'geo.enabled': {
    type: 'boolean', default: true,
    description: 'Record visitor countries, looked up in a local DB-IP Lite database (DATA_DIR/geo, downloaded monthly from db-ip.com; visitor IPs never leave the server).'
  },
  'features.pastes': { type: 'boolean', default: true, description: 'Text pastes (/p/…).' },
  'features.bundles': { type: 'boolean', default: true, description: 'Link bundles.' },
  'features.files': { type: 'boolean', default: true, description: 'File hosting (/f/…).' },
  'features.bioPages': { type: 'boolean', default: true, description: 'Bio pages.' },
  'features.importExport': { type: 'boolean', default: true, description: 'Bulk import and export of links.' },
  'features.analytics': {
    type: 'boolean', default: true,
    description: 'Visit analytics: every visit of a link, bundle, paste or file is recorded (keyed IP hash, referrer, browser, country) and shown on analytics pages. Off: nothing new is recorded and no country database is downloaded; analytics pages, share links and tag analytics are gone. Visits already recorded are kept (retention.analyticsDays still deletes old ones) and come back when it is switched on again. Clicks, views and downloads keep counting, for usage limits.'
  },
  'features.analyticsShareLinks': {
    type: 'boolean', default: true, requires: 'analytics',
    description: 'Read-only analytics share links. Needs features.analytics.'
  },
  'features.reports': { type: 'boolean', default: true, description: 'Visitors can report links for abuse.' },
  'features.qrCodes': { type: 'boolean', default: true, description: 'QR codes for links, pastes, files and bundles.' },
  'features.teams': { type: 'boolean', default: true, description: 'Teams: links, bundles, pastes and files shared by several people.' },
  'moderation.reportThreshold': {
    type: 'integer', min: 0, default: 3,
    description: 'Distinct reporters before a link is quarantined. 0 turns automatic quarantine off.'
  },
  'anonymous.urlExpirationDays': {
    type: 'integer', min: 1, default: 30, env: 'ANONYMOUS_URL_EXPIRATION_DAYS',
    description: 'Longest lifetime, in days, of a link created without an account.'
  },
  'anonymous.pasteExpirationDays': {
    type: 'integer', min: 1, default: 30, env: 'ANONYMOUS_PASTE_EXPIRATION_DAYS',
    description: 'Longest lifetime, in days, of a paste created without an account.'
  },
  'pastes.maxSizeKB': {
    type: 'integer', min: 1, default: 512, env: 'MAX_PASTE_SIZE_KB',
    description: 'Largest paste, in KB.'
  },
  'files.globalMaxFileSizeMB': {
    type: 'integer', min: 1, nullable: true, default: null, env: 'MAX_FILE_SIZE_MB',
    description: 'Hard cap on upload size, in MB, for every role except unlimited. null means no cap.'
  },
  'retention.auditLogDays': {
    type: 'integer', min: 1, default: 90, env: 'AUDIT_LOG_RETENTION_DAYS',
    description: 'Days audit log entries are kept.'
  },
  'retention.analyticsDays': {
    type: 'integer', min: 1, nullable: true, default: null,
    description: 'Days analytics events (visits) are kept; older ones are deleted nightly. null keeps them forever. The counters on items (clicks, views, downloads) are not affected.'
  },
  'retention.expiredGraceDays': {
    type: 'integer', min: 0, default: 90, env: 'EXPIRED_URL_GRACE_PERIOD_DAYS',
    description: "Days an expired registered user's link or paste is kept before it is deleted."
  },
  // `editor: 'appearance'`: set on Admin → Appearance rather than in the Settings form
  'branding.name': {
    type: 'string', minLength: 1, maxLength: 40, default: 'LinkSnip', editor: 'appearance',
    description: 'Name of the site, shown in the header, page titles and on the login pages.'
  },
  'branding.tagline': {
    type: 'string', maxLength: 120, default: 'Short links, pastes, files and bundles, with analytics.', editor: 'appearance',
    description: 'One sentence under the name on the home page and in link previews (search engines, chat apps). Can be empty.'
  },
  'branding.darkPalette': {
    type: 'palette', mode: 'dark', default: 'linksnip-dark', editor: 'appearance',
    description: 'Colors in dark mode: a dark palette id (Admin → Appearance lists them). An unknown id falls back to linksnip-dark.'
  },
  'branding.lightPalette': {
    type: 'palette', mode: 'light', default: 'linksnip-light', editor: 'appearance',
    description: 'Colors in light mode: a light palette id. An unknown id falls back to linksnip-light.'
  }
};

// ─── roles.json ───────────────────────────────────────────────────────────────
const PERMISSIONS = {
  createUrls: 'Create short links.',
  createPastes: 'Create text pastes.',
  createBundles: 'Create link bundles.',
  uploadFiles: 'Upload files.',
  passwordProtection: 'Password-protect links, pastes, bundles and files.',
  scheduling: 'Set activation and deactivation times.',
  tags: 'Organize content with tags.',
  analytics: 'View analytics for their own content.',
  analyticsShareLinks: 'Create read-only analytics share links.',
  importExport: 'Bulk import and export links.',
  bioPage: 'Publish a bio page.',
  skipAutoModeration: 'Their links are never quarantined automatically by reports.',
  createTeams: 'Create teams. Anyone can be invited to a team; this only limits who can start one.'
};

// Every limit is a whole number >= 0, or null for unlimited. 0 means none allowed.
const LIMITS = {
  urlsPerHour: 'Short links created per hour.',
  pastesPerHour: 'Pastes created per hour.',
  bundlesPerHour: 'Bundles created per hour.',
  importsPerHour: 'Bulk imports per hour.',
  importBatchSize: 'Links per bulk import.',
  shareLinksPerUrl: 'Analytics share links per link.',
  maxFileSizeMB: 'Largest upload, in MB.',
  storageQuotaMB: 'Total size of all their files, in MB.',
  uploadsPerHour: 'File uploads per hour.'
};

const BUILT_IN_ROLES = ['anonymous', 'user', 'trusted', 'unlimited'];
const ANONYMOUS_ROLE = 'anonymous';

function describe(value) {
  return JSON.stringify(value);
}

/**
 * Validate one settings value against its spec.
 * @returns {string|null} Problem description, or null when valid.
 */
function checkSetting(spec, value) {
  switch (spec.type) {
    case 'boolean':
      return typeof value === 'boolean' ? null : `must be true or false (got ${describe(value)})`;
    case 'integer': {
      if (value === null && spec.nullable) return null;
      const expected = `a whole number >= ${spec.min}${spec.nullable ? ' or null' : ''}`;
      if (typeof value !== 'number' || !Number.isInteger(value) || value < spec.min) {
        return `must be ${expected} (got ${describe(value)})`;
      }
      return null;
    }
    case 'string': {
      if (typeof value !== 'string') return `must be text (got ${describe(value)})`;
      const length = value.trim().length;
      if (spec.minLength && length < spec.minLength) {
        return `must be at least ${spec.minLength} character${spec.minLength === 1 ? '' : 's'} (got ${describe(value)})`;
      }
      if (spec.maxLength && length > spec.maxLength) return `must be at most ${spec.maxLength} characters (got ${length})`;
      return null;
    }
    // Only the form of the id: whether the palette exists is checked where it's chosen, so deleting a
    // palette file never makes settings.json invalid (paletteService falls back to the default)
    case 'palette':
      return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value)
        ? null
        : `must be a palette id like "tokyo-night" (got ${describe(value)})`;
    default:
      throw new Error(`Unknown setting type: ${spec.type}`);
  }
}

function checkPermission(value) {
  return typeof value === 'boolean' ? null : `must be true or false (got ${describe(value)})`;
}

function checkLimit(value) {
  if (value === null) return null;
  if (typeof value !== 'number') return `must be a number or null (got ${describe(value)})`;
  if (!Number.isInteger(value) || value < 0) return `must be a whole number >= 0 or null (got ${describe(value)})`;
  return null;
}

module.exports = {
  SETTINGS,
  PERMISSIONS,
  LIMITS,
  BUILT_IN_ROLES,
  ANONYMOUS_ROLE,
  checkSetting,
  checkPermission,
  checkLimit
};
