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
  'registration.open': {
    type: 'boolean', default: true,
    description: 'Anyone can create an account. When false, only admins can create accounts.'
  },
  'geo.enabled': {
    type: 'boolean', default: true,
    description: 'Look up visitor countries via ip-api.com (non-commercial terms; sends visitor IPs to a third party).'
  },
  'features.pastes': { type: 'boolean', default: true, description: 'Text pastes (/p/…).' },
  'features.bundles': { type: 'boolean', default: true, description: 'Link bundles.' },
  'features.files': { type: 'boolean', default: true, description: 'File hosting (/f/…).' },
  'features.bioPages': { type: 'boolean', default: true, description: 'Bio pages.' },
  'features.importExport': { type: 'boolean', default: true, description: 'Bulk import and export of links.' },
  'features.analyticsShareLinks': { type: 'boolean', default: true, description: 'Read-only analytics share links.' },
  'features.reports': { type: 'boolean', default: true, description: 'Visitors can report links for abuse.' },
  'features.qrCodes': { type: 'boolean', default: true, description: 'QR codes for links, pastes, files and bundles.' },
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
  'retention.expiredGraceDays': {
    type: 'integer', min: 0, default: 90, env: 'EXPIRED_URL_GRACE_PERIOD_DAYS',
    description: "Days an expired registered user's link or paste is kept before it is deleted."
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
  skipAutoModeration: 'Their links are never quarantined automatically by reports.'
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
