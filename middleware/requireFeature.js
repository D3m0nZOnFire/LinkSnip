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

/**
 * Whether a feature is on: its own switch, and the switch of the feature it needs (schema `requires`, e.g. share
 * links need analytics).
 */
function isEnabled(feature) {
  const setting = SETTINGS[`features.${feature}`];
  if (!configService.get(`features.${feature}`)) return false;
  return !setting.requires || isEnabled(setting.requires);
}

/** Every feature switch as it applies (`requires` resolved), for views */
function enabledFeatures() {
  return Object.fromEntries(Object.keys(SETTINGS)
    .filter(key => key.startsWith('features.'))
    .map(key => key.slice('features.'.length))
    .map(feature => [feature, isEnabled(feature)]));
}

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

module.exports = { requireFeature, featureRoutes, isEnabled, enabledFeatures };
