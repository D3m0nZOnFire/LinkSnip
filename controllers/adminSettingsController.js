const db = require('../config/database');
const configService = require('../services/configService');
const { ConfigValidationError, ConfigConflictError } = require('../services/configService');
const RoleService = require('../services/roleService');
const { SETTINGS, PERMISSIONS, LIMITS, BUILT_IN_ROLES, ANONYMOUS_ROLE } = require('../config/schema');
const paths = require('../config/paths');
const { logAdminAction, ACTIONS } = require('../services/auditService');

/**
 * Admin → Settings
 *
 * Settings and roles are edited here or by hand in DATA_DIR/settings.json and DATA_DIR/roles.json; both are equal.
 * Role edits send back the file's version from the page: if roles.json changed on disk in between, they get a 409
 * and the admin reloads the page.
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
        editor: spec.editor,
        value: configService.get(key)
      });
    }

    const { defaultRole, roles } = configService.getRoles();
    const roleNames = Object.keys(roles);
    const users = accountsPerRole(defaultRole, roles);
    const roleGrid = {
      defaultRole,
      version: configService.rolesVersion(),
      roles: roleNames.map(name => ({
        name, label: roles[name].label, builtIn: BUILT_IN_ROLES.includes(name), users: users[name] || 0
      })),
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

  /**
   * PUT /api/admin/roles
   * Body: { version, defaultRole?, roles?: { name: { label?, permissions?, limits? } } }. A new name creates a role.
   */
  static updateRoles(req, res) {
    const { version, ...patch } = req.body || {};
    const result = editRoles(res, version, () => configService.updateRoles(patch, { version }));
    if (!result) return;

    if (Object.keys(result.changed).length) {
      logAdminAction(ACTIONS.UPDATE_ROLES, req, 'roles', null, 'roles.json', result.changed);
    }
    const { roles } = configService.getRoles();
    for (const name of result.created) {
      logAdminAction(ACTIONS.CREATE_ROLE, req, 'role', name, roles[name].label, roles[name]);
    }
    res.json({ success: true, ...result, version: configService.rolesVersion() });
  }

  /**
   * DELETE /api/admin/roles/:name
   * Body: { version, moveTo } where moveTo is the role its accounts get, or null to clear it (they follow defaultRole).
   */
  static deleteRole(req, res) {
    const { name } = req.params;
    const { version, moveTo } = req.body || {};
    if (moveTo === undefined) {
      return res.status(400).json({ success: false, errors: ['Choose where the accounts with this role go (moveTo)'] });
    }
    if (moveTo !== null && (moveTo === name || !RoleService.isAssignable(moveTo))) {
      return res.status(400).json({ success: false, errors: [`Accounts can't be moved to "${moveTo}"`] });
    }

    // Accounts first, in the same transaction: if the role can't be deleted, they keep it.
    const result = editRoles(res, version, () => db.transaction(() => {
      const moved = db.prepare('UPDATE users SET role = ? WHERE role = ?').run(moveTo, name).changes;
      const role = configService.deleteRole(name, { version });
      return { moved, role };
    })());
    if (!result) return;

    logAdminAction(ACTIONS.DELETE_ROLE, req, 'role', name, result.role.label,
      { role: result.role, moveTo, moved: result.moved });
    res.json({ success: true, moved: result.moved, version: configService.rolesVersion() });
  }

  /**
   * POST /api/admin/roles/:name/reset
   * Body: { version }. Puts a built-in role back to its built-in values.
   */
  static resetRole(req, res) {
    const { name } = req.params;
    const { version } = req.body || {};
    const changed = editRoles(res, version, () => configService.resetRole(name, { version }));
    if (!changed) return;

    if (Object.keys(changed).length) {
      logAdminAction(ACTIONS.RESET_ROLE, req, 'role', name, configService.getRoles().roles[name].label, changed);
    }
    const role = configService.getRoles().roles[name];
    res.json({ success: true, changed, role, version: configService.rolesVersion() });
  }
}

/**
 * Run a role edit and answer its errors (400 invalid, 409 changed on disk, 500).
 * @returns The edit's result, or undefined when a response was sent.
 */
function editRoles(res, version, edit) {
  if (typeof version !== 'string' || !version) {
    res.status(400).json({ success: false, errors: ['Missing the roles version; reload the page.'] });
    return undefined;
  }
  try {
    return edit();
  } catch (error) {
    if (error instanceof ConfigConflictError) {
      res.status(409).json({ success: false, conflict: true, errors: [error.message] });
    } else if (error instanceof ConfigValidationError) {
      res.status(400).json({ success: false, errors: error.errors });
    } else {
      console.error('Update roles error:', error);
      res.status(500).json({ success: false, errors: ['Could not save roles.json'] });
    }
    return undefined;
  }
}

/** Accounts per role as the app resolves them: NULL or unknown roles count for the default role. */
function accountsPerRole(defaultRole, roles) {
  const counts = {};
  for (const { role, n } of db.prepare('SELECT role, COUNT(*) AS n FROM users GROUP BY role').all()) {
    const name = role && role !== ANONYMOUS_ROLE && Object.prototype.hasOwnProperty.call(roles, role) ? role : defaultRole;
    counts[name] = (counts[name] || 0) + n;
  }
  return counts;
}

module.exports = AdminSettingsController;
