const configService = require('../services/configService');
const { ConfigValidationError } = require('../services/configService');
const { SETTINGS, PERMISSIONS, LIMITS } = require('../config/schema');
const paths = require('../config/paths');
const { logAdminAction, ACTIONS } = require('../services/auditService');

/**
 * Admin → Settings
 *
 * Settings are edited here or by hand in DATA_DIR/settings.json; both are equal.
 * Roles are shown read-only (they are edited in DATA_DIR/roles.json).
 * Everything shown comes from config/schema.js, so help text can't drift from validation.
 */
class AdminSettingsController {
  /**
   * GET /admin/settings
   */
  static getSettingsPage(req, res) {
    const sections = [];
    for (const [key, spec] of Object.entries(SETTINGS)) {
      const name = key.split('.')[0];
      let section = sections.find(s => s.name === name);
      if (!section) sections.push(section = { name, fields: [] });
      section.fields.push({
        key,
        type: spec.type,
        min: spec.min,
        nullable: !!spec.nullable,
        description: spec.description,
        value: configService.get(key)
      });
    }

    const { defaultRole, roles } = configService.getRoles();
    const roleNames = Object.keys(roles);
    const roleGrid = {
      defaultRole,
      roles: roleNames.map(name => ({ name, label: roles[name].label })),
      permissions: Object.entries(PERMISSIONS).map(([name, description]) => ({
        name, description, values: roleNames.map(r => roles[r].permissions[name])
      })),
      limits: Object.entries(LIMITS).map(([name, description]) => ({
        name, description, values: roleNames.map(r => roles[r].limits[name])
      }))
    };

    res.render('admin-settings', {
      user: req.user,
      sections,
      roleGrid,
      files: { settings: paths.SETTINGS_PATH, roles: paths.ROLES_PATH }
    });
  }

  /**
   * PUT /api/admin/settings
   * Body: { 'dotted.key': value, ... } with JSON types (booleans, numbers, null).
   */
  static updateSettings(req, res) {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ success: false, errors: ['Expected an object of settings'] });
    }

    let changed;
    try {
      changed = configService.updateSettings(body);
    } catch (error) {
      if (error instanceof ConfigValidationError) {
        return res.status(400).json({ success: false, errors: error.errors });
      }
      console.error('Update settings error:', error);
      return res.status(500).json({ success: false, errors: ['Could not save settings.json'] });
    }

    if (Object.keys(changed).length) {
      logAdminAction(ACTIONS.UPDATE_SETTINGS, req, 'settings', null, 'settings.json', changed);
    }
    res.json({ success: true, changed });
  }
}

module.exports = AdminSettingsController;
