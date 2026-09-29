const fs = require('fs');
const os = require('os');
const path = require('path');
const { ConfigService, ConfigValidationError } = require('../../../services/configService');
const defaultRoles = require('../../../config/roles.default.json');

let dir;
let service;
let logger;

function makeService(opts = {}) {
  logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  service = new ConfigService({
    settingsPath: path.join(dir, 'settings.json'),
    rolesPath: path.join(dir, 'roles.json'),
    env: {},
    logger,
    pollIntervalMs: 20,
    ...opts
  });
  return service;
}

function writeJson(name, data) {
  fs.writeFileSync(path.join(dir, name), typeof data === 'string' ? data : JSON.stringify(data));
}

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
}

function nextEvent(emitter, event, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no '${event}' event within ${timeoutMs}ms`)), timeoutMs);
    emitter.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

// fs.watchFile takes its baseline stat asynchronously; let one poll pass before editing.
const settle = () => new Promise(resolve => setTimeout(resolve, 100));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linksnip-config-'));
});

afterEach(() => {
  if (service) service.unwatch();
  service = null;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('ConfigService', () => {
  describe('defaults', () => {
    it('returns built-in defaults when no files exist', () => {
      makeService().load();

      expect(service.get('registration.open')).toBe(true);
      expect(service.get('geo.enabled')).toBe(true);
      expect(service.get('moderation.reportThreshold')).toBe(3);
      expect(service.get('anonymous.urlExpirationDays')).toBe(30);
      expect(service.get('anonymous.pasteExpirationDays')).toBe(30);
      expect(service.get('pastes.maxSizeKB')).toBe(512);
      expect(service.get('files.globalMaxFileSizeMB')).toBeNull();
      expect(service.get('retention.auditLogDays')).toBe(90);
      expect(service.get('retention.expiredGraceDays')).toBe(90);
    });

    it('enables every feature switch by default', () => {
      makeService().load();

      for (const feature of ['pastes', 'bundles', 'files', 'bioPages', 'importExport',
        'analyticsShareLinks', 'reports', 'qrCodes']) {
        expect(service.get(`features.${feature}`)).toBe(true);
      }
    });

    it('returns the built-in roles when no roles file exists', () => {
      makeService().load();
      const { defaultRole, roles } = service.getRoles();

      expect(defaultRole).toBe('user');
      expect(Object.keys(roles).sort()).toEqual(['anonymous', 'trusted', 'unlimited', 'user']);
    });

    it('loads lazily on first read', () => {
      makeService();
      expect(service.get('pastes.maxSizeKB')).toBe(512);
    });

    it('throws on an unknown settings key read (programmer error)', () => {
      makeService().load();
      expect(() => service.get('nope.nothing')).toThrow(/Unknown setting/);
    });
  });

  describe('merge', () => {
    it('merges a partial settings file over the defaults', () => {
      writeJson('settings.json', { registration: { open: false }, pastes: { maxSizeKB: 64 } });
      makeService().load();

      expect(service.get('registration.open')).toBe(false);
      expect(service.get('pastes.maxSizeKB')).toBe(64);
      expect(service.get('geo.enabled')).toBe(true);
    });

    it('deep-merges a partial roles file over the default roles', () => {
      writeJson('roles.json', { roles: { trusted: { limits: { maxFileSizeMB: 500 } } } });
      makeService().load();
      const { roles } = service.getRoles();

      expect(roles.trusted.limits.maxFileSizeMB).toBe(500);
      expect(roles.trusted.limits.storageQuotaMB).toBe(defaultRoles.roles.trusted.limits.storageQuotaMB);
      expect(roles.trusted.permissions.uploadFiles).toBe(true);
      expect(roles.user).toEqual(defaultRoles.roles.user);
    });

    it('fills a custom role from the built-in user role', () => {
      writeJson('roles.json', { roles: { marketing: { permissions: { uploadFiles: true } } } });
      makeService().load();
      const { roles } = service.getRoles();

      expect(roles.marketing.label).toBe('marketing');
      expect(roles.marketing.permissions.uploadFiles).toBe(true);
      expect(roles.marketing.permissions.tags).toBe(defaultRoles.roles.user.permissions.tags);
      expect(roles.marketing.limits).toEqual(defaultRoles.roles.user.limits);
    });

    it('accepts null limits as unlimited', () => {
      writeJson('roles.json', { roles: { user: { limits: { urlsPerHour: null } } } });
      makeService().load();

      expect(service.getRoles().roles.user.limits.urlsPerHour).toBeNull();
    });
  });

  describe('validation', () => {
    it('reports file, key and problem for a bad role limit', () => {
      writeJson('roles.json', { roles: { trusted: { limits: { maxFileSizeMB: '100MB' } } } });
      makeService().load();

      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining(
        'roles.json: roles.trusted.limits.maxFileSizeMB must be a number or null (got "100MB")'
      ));
    });

    it('reports file, key and problem for a bad setting', () => {
      writeJson('settings.json', { registration: { open: 'yes' } });
      makeService().load();

      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining(
        'settings.json: registration.open must be true or false (got "yes")'
      ));
    });

    it('rejects negative and fractional numbers', () => {
      makeService().load();

      expect(() => service.updateSettings({ 'pastes.maxSizeKB': -5 })).toThrow(ConfigValidationError);
      expect(() => service.updateSettings({ 'moderation.reportThreshold': 1.5 })).toThrow(ConfigValidationError);
    });

    it('allows a reportThreshold of 0 (automatic quarantine off)', () => {
      makeService().load();
      service.updateSettings({ 'moderation.reportThreshold': 0 });
      expect(service.get('moderation.reportThreshold')).toBe(0);
    });

    it('rejects a defaultRole that does not exist', () => {
      writeJson('roles.json', { defaultRole: 'ghost' });
      makeService().load();

      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('roles.json: defaultRole'));
      expect(service.getRoles().defaultRole).toBe('user');
    });

    it('rejects anonymous as defaultRole', () => {
      writeJson('roles.json', { defaultRole: 'anonymous' });
      makeService().load();

      expect(service.getRoles().defaultRole).toBe('user');
    });

    it('warns about unknown keys without rejecting the file', () => {
      writeJson('settings.json', { registation: { open: false }, pastes: { maxSizeKB: 10 } });
      makeService().load();

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('settings.json: unknown key "registation.open"'));
      expect(service.get('pastes.maxSizeKB')).toBe(10);
    });

    it('warns about unknown permissions in a role', () => {
      writeJson('roles.json', { roles: { user: { permissions: { flyToMoon: true } } } });
      makeService().load();

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('roles.user.permissions.flyToMoon'));
    });
  });

  describe('invalid file keeps the last good config', () => {
    it('falls back to defaults when the first load is invalid JSON', () => {
      writeJson('settings.json', '{ not json');
      makeService().load();

      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('settings.json'));
      expect(service.get('registration.open')).toBe(true);
    });

    it('keeps the previously loaded values when a reload finds an invalid file', () => {
      writeJson('settings.json', { pastes: { maxSizeKB: 64 } });
      makeService().load();

      writeJson('settings.json', { pastes: { maxSizeKB: 'lots' } });
      service.reload();

      expect(service.get('pastes.maxSizeKB')).toBe(64);
    });

    it('keeps the previous roles when a reload finds an invalid roles file', () => {
      writeJson('roles.json', { roles: { user: { limits: { urlsPerHour: 5 } } } });
      makeService().load();

      writeJson('roles.json', { roles: { user: { limits: { urlsPerHour: 'x' } } } });
      service.reload();

      expect(service.getRoles().roles.user.limits.urlsPerHour).toBe(5);
    });
  });

  describe('writing', () => {
    it('writes atomically and reads the value back', () => {
      makeService().load();
      service.updateSettings({ 'registration.open': false, 'pastes.maxSizeKB': 100 });

      expect(service.get('registration.open')).toBe(false);
      expect(readJson('settings.json').registration.open).toBe(false);
      expect(readJson('settings.json').pastes.maxSizeKB).toBe(100);

      const leftovers = fs.readdirSync(dir).filter(f => f.includes('.tmp'));
      expect(leftovers).toEqual([]);

      const fresh = makeService();
      fresh.load();
      expect(fresh.get('pastes.maxSizeKB')).toBe(100);
    });

    it('writes every key so the file documents all options', () => {
      makeService().load();
      service.updateSettings({ 'geo.enabled': false });

      const file = readJson('settings.json');
      expect(file.features.qrCodes).toBe(true);
      expect(file.retention.auditLogDays).toBe(90);
      expect(file.files.globalMaxFileSizeMB).toBeNull();
    });

    it('returns the diff of changed keys', () => {
      makeService().load();
      const diff = service.updateSettings({ 'registration.open': false, 'geo.enabled': true });

      expect(diff).toEqual({ 'registration.open': { from: true, to: false } });
    });

    it('accepts a nested patch', () => {
      makeService().load();
      service.updateSettings({ anonymous: { urlExpirationDays: 7 } });
      expect(service.get('anonymous.urlExpirationDays')).toBe(7);
    });

    it('rejects an invalid update without touching the file or memory', () => {
      writeJson('settings.json', { pastes: { maxSizeKB: 64 } });
      makeService().load();

      let error;
      try {
        service.updateSettings({ 'pastes.maxSizeKB': 'big', 'geo.enabled': false });
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(ConfigValidationError);
      expect(error.errors[0]).toMatch(/pastes\.maxSizeKB/);
      expect(service.get('pastes.maxSizeKB')).toBe(64);
      expect(service.get('geo.enabled')).toBe(true);
      expect(readJson('settings.json')).toEqual({ pastes: { maxSizeKB: 64 } });
    });

    it('rejects an unknown key in an update', () => {
      makeService().load();
      expect(() => service.updateSettings({ 'registration.opne': false })).toThrow(ConfigValidationError);
    });

    it('has no registration.defaultRole: new accounts follow roles.json defaultRole', () => {
      makeService().load();
      expect(() => service.get('registration.defaultRole')).toThrow(/Unknown setting/);
      expect(() => service.updateSettings({ 'registration.defaultRole': 'trusted' })).toThrow(ConfigValidationError);
    });

    it('warns about a leftover registration.defaultRole in the file without rejecting it', () => {
      writeJson('settings.json', { registration: { open: false, defaultRole: 'trusted' } });
      makeService().load();

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('unknown key "registration.defaultRole"'));
      expect(service.get('registration.open')).toBe(false);
    });

    it('emits change after an update', () => {
      makeService().load();
      const onChange = jest.fn();
      service.on('change', onChange);

      service.updateSettings({ 'geo.enabled': false });

      expect(onChange).toHaveBeenCalledWith({ file: 'settings' });
    });
  });

  describe('hot reload', () => {
    it('applies an external edit to settings.json without a restart', async () => {
      makeService().load({ seed: true });
      service.watch();
      await settle();

      const changed = nextEvent(service, 'change');
      writeJson('settings.json', { ...readJson('settings.json'), registration: { open: false } });
      await changed;

      expect(service.get('registration.open')).toBe(false);
    });

    it('applies an external edit to roles.json without a restart', async () => {
      makeService().load({ seed: true });
      service.watch();
      await settle();

      const changed = nextEvent(service, 'change');
      writeJson('roles.json', { roles: { user: { limits: { urlsPerHour: 7 } } } });
      await changed;

      expect(service.getRoles().roles.user.limits.urlsPerHour).toBe(7);
    });

    it('keeps the last good config when an external edit is invalid', async () => {
      makeService().load({ seed: true });
      service.watch();
      await settle();

      const invalid = nextEvent(service, 'invalid');
      writeJson('settings.json', '{ broken');
      const payload = await invalid;

      expect(payload.file).toBe('settings');
      expect(service.get('registration.open')).toBe(true);
    });
  });

  describe('seeding', () => {
    it('creates both files with every default on first start', () => {
      makeService().load({ seed: true });

      const settings = readJson('settings.json');
      expect(settings.registration).toEqual({ open: true });
      expect(Object.keys(settings.features)).toHaveLength(8);
      expect(readJson('roles.json')).toEqual(defaultRoles);
    });

    it('carries over legacy env vars into the seeded settings', () => {
      makeService({
        env: {
          ANONYMOUS_URL_EXPIRATION_DAYS: '14',
          ANONYMOUS_PASTE_EXPIRATION_DAYS: '7',
          MAX_PASTE_SIZE_KB: '256',
          MAX_FILE_SIZE_MB: '50',
          AUDIT_LOG_RETENTION_DAYS: '30',
          EXPIRED_URL_GRACE_PERIOD_DAYS: '60'
        }
      }).load({ seed: true });

      const settings = readJson('settings.json');
      expect(settings.anonymous).toEqual({ urlExpirationDays: 14, pasteExpirationDays: 7 });
      expect(settings.pastes.maxSizeKB).toBe(256);
      expect(settings.files.globalMaxFileSizeMB).toBe(50);
      expect(settings.retention).toEqual({ auditLogDays: 30, expiredGraceDays: 60 });
    });

    it('ignores an invalid legacy env var and logs it', () => {
      makeService({ env: { MAX_PASTE_SIZE_KB: 'huge' } }).load({ seed: true });

      expect(readJson('settings.json').pastes.maxSizeKB).toBe(512);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('MAX_PASTE_SIZE_KB'));
    });

    it('does not read env vars once settings.json exists', () => {
      writeJson('settings.json', {});
      makeService({ env: { MAX_PASTE_SIZE_KB: '256' } }).load({ seed: true });

      expect(service.get('pastes.maxSizeKB')).toBe(512);
      expect(readJson('settings.json')).toEqual({});
    });

    it('does not create files unless asked to seed', () => {
      makeService().load();
      expect(fs.readdirSync(dir)).toEqual([]);
    });
  });
});
