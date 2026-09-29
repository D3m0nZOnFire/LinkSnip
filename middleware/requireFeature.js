const configService = require('../services/configService');
const { SETTINGS } = require('../config/schema');

/**
 * Instance-wide feature switches (settings.json → features.*).
 * A switched-off feature doesn't exist: its routes fall through to the app's 404,
 * for everyone including admins. The switch is read on every request.
 */

function assertFeature(feature) {
  if (!(`features.${feature}` in SETTINGS)) throw new Error(`Unknown feature: ${feature}`);
}

const isEnabled = (feature) => configService.get(`features.${feature}`);

/** Route-level: skips the route when the feature is off. */
function requireFeature(feature) {
  assertFeature(feature);
  return (req, res, next) => (isEnabled(feature) ? next() : next('route'));
}

/** Router-level: skips a whole feature router when the feature is off. */
function featureRoutes(feature, router) {
  assertFeature(feature);
  return (req, res, next) => (isEnabled(feature) ? router(req, res, next) : next());
}

module.exports = { requireFeature, featureRoutes, isEnabled };
