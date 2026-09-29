const fs = require('fs');
const paths = require('../../../config/paths');
const configService = require('../../../services/configService');
const RoleService = require('../../../services/roleService');
const defaultRoles = require('../../../config/roles.default.json');

function setRolesFile(data) {
  fs.writeFileSync(paths.ROLES_PATH, JSON.stringify(data));
  configService.reload();
}

afterEach(() => {
  fs.rmSync(paths.ROLES_PATH, { force: true });
  configService.reload();
});

describe('RoleService', () => {
  describe('getRole', () => {
    it('resolves a visitor without an account to anonymous', () => {
      expect(RoleService.getRole(null).name).toBe('anonymous');
      expect(RoleService.getRole(undefined).name).toBe('anonymous');
    });

    it('resolves a user with no role to the defaultRole', () => {
      expect(RoleService.getRole({ id: 1, role: null }).name).toBe('user');
    });

    it('resolves a user with a known role to that role', () => {
      const role = RoleService.getRole({ id: 1, role: 'trusted' });
      expect(role.name).toBe('trusted');
      expect(role.label).toBe('Trusted');
    });

    it('falls back to defaultRole for an unknown role', () => {
      expect(RoleService.getRole({ id: 1, role: 'pro' }).name).toBe('user');
    });

    it('never lets a logged-in user resolve to anonymous', () => {
      expect(RoleService.getRole({ id: 1, role: 'anonymous' }).name).toBe('user');
    });

    it('follows a changed defaultRole', () => {
      setRolesFile({ defaultRole: 'trusted' });
      expect(RoleService.getRole({ id: 1, role: null }).name).toBe('trusted');
    });
  });

  describe('can', () => {
    it('matches the default permission table for anonymous visitors', () => {
      expect(RoleService.can(null, 'createUrls')).toBe(true);
      expect(RoleService.can(null, 'createPastes')).toBe(true);
      expect(RoleService.can(null, 'createBundles')).toBe(true);
      expect(RoleService.can(null, 'uploadFiles')).toBe(false);
      expect(RoleService.can(null, 'passwordProtection')).toBe(false);
      expect(RoleService.can(null, 'tags')).toBe(false);
      expect(RoleService.can(null, 'importExport')).toBe(false);
    });

    it('matches the default permission table for users', () => {
      const user = { id: 1, role: null };
      expect(RoleService.can(user, 'uploadFiles')).toBe(false);
      expect(RoleService.can(user, 'passwordProtection')).toBe(true);
      expect(RoleService.can(user, 'analyticsShareLinks')).toBe(true);
      expect(RoleService.can(user, 'skipAutoModeration')).toBe(false);
    });

    it('lets trusted users upload files and skip auto-moderation', () => {
      const user = { id: 1, role: 'trusted' };
      expect(RoleService.can(user, 'uploadFiles')).toBe(true);
      expect(RoleService.can(user, 'skipAutoModeration')).toBe(true);
    });

    it('grants every permission to admins regardless of role', () => {
      const admin = { id: 1, role: null, isAdmin: 1 };
      expect(RoleService.can(admin, 'uploadFiles')).toBe(true);
      expect(RoleService.can(admin, 'skipAutoModeration')).toBe(true);
    });

    it('grants every permission to the unlimited role', () => {
      const user = { id: 1, role: 'unlimited' };
      for (const perm of Object.keys(defaultRoles.roles.user.permissions)) {
        expect(RoleService.can(user, perm)).toBe(true);
      }
    });

    it('applies a partial override on top of the defaults', () => {
      setRolesFile({ roles: { anonymous: { permissions: { createUrls: false } } } });
      expect(RoleService.can(null, 'createUrls')).toBe(false);
      expect(RoleService.can(null, 'createPastes')).toBe(true);
    });

    it('throws on an unknown permission name (programmer error)', () => {
      expect(() => RoleService.can(null, 'flyToMoon')).toThrow(/Unknown permission/);
    });
  });

  describe('limit', () => {
    it('returns the role limit', () => {
      expect(RoleService.limit(null, 'urlsPerHour')).toBe(10);
      expect(RoleService.limit({ id: 1, role: null }, 'urlsPerHour')).toBe(100);
      expect(RoleService.limit({ id: 1, role: 'trusted' }, 'maxFileSizeMB')).toBe(100);
    });

    it('returns null (unlimited) for admins', () => {
      expect(RoleService.limit({ id: 1, isAdmin: 1 }, 'urlsPerHour')).toBeNull();
      expect(RoleService.limit({ id: 1, isAdmin: true }, 'storageQuotaMB')).toBeNull();
    });

    it('returns null for every limit of the unlimited role', () => {
      const user = { id: 1, role: 'unlimited' };
      for (const name of Object.keys(defaultRoles.roles.user.limits)) {
        expect(RoleService.limit(user, name)).toBeNull();
      }
    });

    it('keeps null as unlimited when set in the roles file', () => {
      setRolesFile({ roles: { user: { limits: { importBatchSize: null } } } });
      expect(RoleService.limit({ id: 1 }, 'importBatchSize')).toBeNull();
    });

    it('keeps 0 as "none allowed"', () => {
      expect(RoleService.limit({ id: 1 }, 'maxFileSizeMB')).toBe(0);
    });

    it('reads edits live, without a restart', () => {
      expect(RoleService.limit({ id: 1 }, 'urlsPerHour')).toBe(100);
      setRolesFile({ roles: { user: { limits: { urlsPerHour: 3 } } } });
      expect(RoleService.limit({ id: 1 }, 'urlsPerHour')).toBe(3);
    });

    it('throws on an unknown limit name (programmer error)', () => {
      expect(() => RoleService.limit(null, 'lightyears')).toThrow(/Unknown limit/);
    });
  });

  describe('listRoles', () => {
    it('lists assignable roles with labels, without anonymous', () => {
      expect(RoleService.listRoles()).toEqual([
        { name: 'user', label: 'User' },
        { name: 'trusted', label: 'Trusted' },
        { name: 'unlimited', label: 'Unlimited' }
      ]);
    });

    it('includes custom roles from the roles file', () => {
      setRolesFile({ roles: { marketing: { label: 'Marketing' } } });
      expect(RoleService.listRoles()).toContainEqual({ name: 'marketing', label: 'Marketing' });
    });
  });

  describe('isAssignable', () => {
    it('accepts known roles and rejects anonymous or unknown ones', () => {
      expect(RoleService.isAssignable('trusted')).toBe(true);
      expect(RoleService.isAssignable('anonymous')).toBe(false);
      expect(RoleService.isAssignable('pro')).toBe(false);
    });
  });
});
