const configService = require('./configService');
const { PERMISSIONS, LIMITS, ANONYMOUS_ROLE } = require('../config/schema');

/**
 * Role Service
 *
 * Roles are named sets of permissions and limits defined in DATA_DIR/roles.json
 * (see config/roles.default.json). Every lookup reads the live config, so role
 * edits apply without a restart.
 *
 * - A visitor without an account is `anonymous`.
 * - A user whose role is NULL or unknown gets `defaultRole`.
 * - `isAdmin` is separate: admins have every permission and no limits.
 * - A limit of null means unlimited; 0 means none allowed.
 */
class RoleService {
  /**
   * @param {object|null} user - req.user (null for anonymous visitors)
   * @returns {{ name, label, permissions, limits }}
   */
  static getRole(user) {
    const { defaultRole, roles } = configService.getRoles();
    let name;
    if (!user) name = ANONYMOUS_ROLE;
    else if (user.role && user.role !== ANONYMOUS_ROLE && roles[user.role]) name = user.role;
    else name = defaultRole;
    return { name, ...roles[name] };
  }

  /**
   * Whether the user may use a permission.
   * @param {object|null} user
   * @param {string} permission - A key of PERMISSIONS in config/schema.js
   */
  static can(user, permission) {
    if (!(permission in PERMISSIONS)) throw new Error(`Unknown permission: ${permission}`);
    if (user && user.isAdmin) return true;
    return this.getRole(user).permissions[permission] === true;
  }

  /**
   * The user's limit, or null for unlimited.
   * @param {object|null} user
   * @param {string} name - A key of LIMITS in config/schema.js
   * @returns {number|null}
   */
  static limit(user, name) {
    if (!(name in LIMITS)) throw new Error(`Unknown limit: ${name}`);
    if (user && user.isAdmin) return null;
    return this.getRole(user).limits[name];
  }

  /**
   * Roles an account can be given (everything except anonymous).
   * @returns {Array<{ name, label }>}
   */
  static listRoles() {
    const { roles } = configService.getRoles();
    return Object.entries(roles)
      .filter(([name]) => name !== ANONYMOUS_ROLE)
      .map(([name, role]) => ({ name, label: role.label }));
  }

  static isAssignable(name) {
    return name !== ANONYMOUS_ROLE && Object.prototype.hasOwnProperty.call(configService.getRoles().roles, name);
  }
}

module.exports = RoleService;
