const configService = require('../services/configService');
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
    reportReasons: require('../models/Report').REASONS
  };
}

/**
 * Per request (res.locals): `features.<name>` (settings.json switches), `can.<permission>` (role and
 * feature), `registrationOpen`, and the teams the user can create items in ("Create in").
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
  next();
}

module.exports = { viewLocals, appLocals };
