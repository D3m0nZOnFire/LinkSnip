const configService = require('../services/configService');
const brandingService = require('../services/brandingService');
const RoleService = require('../services/roleService');
const teamService = require('../services/teamService');
const { PERMISSIONS } = require('../config/schema');

// A permission tied to a switched-off feature is false for everyone
const FEATURE_OF_PERMISSION = {
  createPastes: 'pastes',
  createBundles: 'bundles',
  uploadFiles: 'files',
  bioPage: 'bioPages',
  importExport: 'importExport',
  analyticsShareLinks: 'analyticsShareLinks',
  createTeams: 'teams'
};

/**
 * Fixed for every view (app.locals): the version in the footer, the reasons in partials/report-modal.
 */
function appLocals() {
  return {
    appVersion: require('../package.json').version,
    minPasswordLength: require('../services/passwordPolicy').MIN_PASSWORD_LENGTH,
    reportReasons: require('../models/Report').REASONS
  };
}

/**
 * Per request (res.locals): `features.<name>` (settings.json switches), `can.<permission>` (role and
 * feature), `registrationOpen`, the teams the user can create items in ("Create in"), and the hourly creation
 * `limits` the create page states (null = none).
 */
function viewLocals(req, res, next) {
  const features = configService.getSettings().features;
  res.locals.features = features;
  res.locals.registrationOpen = configService.get('registration.open');
  res.locals.can = Object.fromEntries(Object.keys(PERMISSIONS).map(p => {
    const feature = FEATURE_OF_PERMISSION[p];
    return [p, (!feature || features[feature]) && RoleService.can(req.user || null, p)];
  }));
  res.locals.canUploadFiles = res.locals.can.uploadFiles;
  res.locals.writableTeams = req.user ? teamService.writableTeams(req.user) : [];
  res.locals.limits = Object.fromEntries(['urlsPerHour', 'pastesPerHour', 'bundlesPerHour', 'uploadsPerHour', 'importsPerHour', 'importBatchSize']
    .map(name => [name, RoleService.limit(req.user || null, name)]));
  next();
}

/**
 * `branding` (name, tagline, logo, favicon, theme stylesheet) for every page. Mounted before the session, so
 * the setup page and early error pages have it too.
 */
function brandingLocals(req, res, next) {
  res.locals.branding = brandingService.locals();
  next();
}

module.exports = { viewLocals, appLocals, brandingLocals };
