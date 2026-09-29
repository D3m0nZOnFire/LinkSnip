const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const paths = require('../config/paths');
const schema = require('../config/schema');
const DEFAULT_ROLES = require('../config/roles.default.json');

/**
 * Config Service
 *
 * Loads, validates, watches and writes DATA_DIR/settings.json and DATA_DIR/roles.json.
 * The Admin → Settings page and a hand edit of the file are equal ways to change them.
 *
 * - Built-in defaults are merged with each file, and every key is validated.
 * - An invalid file is logged and the last good config is kept.
 * - fs.watchFile polls both files (works on Docker bind mounts), so edits apply without a restart.
 * - On first start the files are created with every default, carrying over legacy env vars once.
 *
 * Events: 'change' { file: 'settings' | 'roles' }, 'invalid' { file, errors }.
 */

class ConfigValidationError extends Error {
  constructor(errors) {
    super(errors.join('\n'));
    this.name = 'ConfigValidationError';
    this.errors = errors;
  }
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => JSON.parse(JSON.stringify(v));

function deepFreeze(obj) {
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') deepFreeze(value);
  }
  return Object.freeze(obj);
}

function defaultSettings() {
  const values = {};
  for (const [key, spec] of Object.entries(schema.SETTINGS)) values[key] = spec.default;
  return values;
}

// Nested settings object → { 'a.b': value }. Stops descending at known setting keys,
// so a known key holding an object is reported as invalid rather than silently ignored.
function flattenSettings(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (!(key in schema.SETTINGS) && isPlainObject(v)) flattenSettings(v, key, out);
    else out[key] = v;
  }
  return out;
}

function nestSettings(flat) {
  const out = {};
  for (const [key, value] of Object.entries(flat)) {
    const parts = key.split('.');
    let node = out;
    for (const part of parts.slice(0, -1)) node = node[part] = node[part] || {};
    node[parts[parts.length - 1]] = value;
  }
  return out;
}

function assignableRoleNames(roles) {
  return Object.keys(roles.roles).filter(name => name !== schema.ANONYMOUS_ROLE);
}

class ConfigService extends EventEmitter {
  constructor({ settingsPath, rolesPath, env = process.env, logger = console, pollIntervalMs = 2000 }) {
    super();
    this.settingsPath = settingsPath;
    this.rolesPath = rolesPath;
    this.env = env;
    this.logger = logger;
    this.pollIntervalMs = pollIntervalMs;
    this._settings = defaultSettings();
    this._roles = deepFreeze(clone(DEFAULT_ROLES));
    this._loaded = false;
    this._listeners = null;
  }

  // ─── Loading ──────────────────────────────────────────────────────────────

  /**
   * Load both files. With seed: true, missing files are first created from the defaults.
   */
  load({ seed = false } = {}) {
    if (seed) this._seed();
    this._loaded = true;
    this._loadRoles();
    this._loadSettings();
  }

  reload() {
    this.load();
  }

  _ensureLoaded() {
    if (!this._loaded) this.load();
  }

  _read(filePath) {
    let text;
    try {
      text = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return { data: {} };
      return { errors: [`${path.basename(filePath)}: cannot be read (${err.message})`] };
    }
    try {
      const data = JSON.parse(text);
      if (!isPlainObject(data)) return { errors: [`${path.basename(filePath)}: must contain a JSON object`] };
      return { data };
    } catch (err) {
      return { errors: [`${path.basename(filePath)}: invalid JSON (${err.message})`] };
    }
  }

  _reject(file, errors) {
    for (const e of errors) this.logger.error(`⚠️  ${e}`);
    this.logger.error(`⚠️  ${file}.json was not applied; keeping the last good configuration.`);
    this.emit('invalid', { file, errors });
  }

  _loadSettings() {
    const { data, errors: readErrors } = this._read(this.settingsPath);
    if (readErrors) return this._reject('settings', readErrors);

    const { values, errors, warnings } = this._validateSettings(flattenSettings(data), { unknownIsError: false });
    for (const w of warnings) this.logger.warn(`⚠️  ${w}`);
    if (errors.length) return this._reject('settings', errors);

    const changed = JSON.stringify(values) !== JSON.stringify(this._settings);
    this._settings = values;
    if (changed) this.emit('change', { file: 'settings' });
  }

  _loadRoles() {
    const { data, errors: readErrors } = this._read(this.rolesPath);
    if (readErrors) return this._reject('roles', readErrors);

    const { roles, errors, warnings } = this._mergeRoles(data);
    for (const w of warnings) this.logger.warn(`⚠️  ${w}`);
    if (errors.length) return this._reject('roles', errors);

    const changed = JSON.stringify(roles) !== JSON.stringify(this._roles);
    this._roles = deepFreeze(roles);
    if (changed) this.emit('change', { file: 'roles' });
  }

  // ─── Validation ───────────────────────────────────────────────────────────

  /**
   * Merge flat overrides over the defaults and validate them.
   * @returns {{ values, errors: string[], warnings: string[] }}
   */
  _validateSettings(flat, { unknownIsError, base = defaultSettings() }) {
    const values = { ...base };
    const errors = [];
    const warnings = [];

    for (const [key, value] of Object.entries(flat)) {
      const spec = schema.SETTINGS[key];
      if (!spec) {
        (unknownIsError ? errors : warnings).push(`settings.json: unknown key "${key}"${unknownIsError ? '' : ' (ignored)'}`);
        continue;
      }
      const problem = schema.checkSetting(spec, value);
      if (problem) errors.push(`settings.json: ${key} ${problem}`);
      else values[key] = value;
    }

    return { values, errors, warnings };
  }

  _mergeRoles(data) {
    const errors = [];
    const warnings = [];
    const roles = clone(DEFAULT_ROLES);

    for (const key of Object.keys(data)) {
      if (key !== 'defaultRole' && key !== 'roles') warnings.push(`roles.json: unknown key "${key}" (ignored)`);
    }

    const fileRoles = data.roles === undefined ? {} : data.roles;
    if (!isPlainObject(fileRoles)) {
      errors.push('roles.json: roles must be an object');
      return { roles, errors, warnings };
    }

    for (const [name, override] of Object.entries(fileRoles)) {
      const where = `roles.${name}`;
      if (!isPlainObject(override)) {
        errors.push(`roles.json: ${where} must be an object`);
        continue;
      }
      // Custom roles start from the built-in user role: "like a user, except …".
      const role = roles.roles[name] || { ...clone(DEFAULT_ROLES.roles.user), label: name };

      for (const key of Object.keys(override)) {
        if (!['label', 'permissions', 'limits'].includes(key)) warnings.push(`roles.json: unknown key "${where}.${key}" (ignored)`);
      }

      if (override.label !== undefined) {
        if (typeof override.label === 'string' && override.label.trim()) role.label = override.label;
        else errors.push(`roles.json: ${where}.label must be a non-empty string (got ${JSON.stringify(override.label)})`);
      }

      this._mergeSection(override, role, where, 'permissions', schema.PERMISSIONS, schema.checkPermission, errors, warnings);
      this._mergeSection(override, role, where, 'limits', schema.LIMITS, schema.checkLimit, errors, warnings);

      roles.roles[name] = role;
    }

    if (data.defaultRole !== undefined) {
      if (typeof data.defaultRole === 'string' && assignableRoleNames(roles).includes(data.defaultRole)) {
        roles.defaultRole = data.defaultRole;
      } else {
        errors.push(`roles.json: defaultRole must name a role defined in roles.json other than anonymous (got ${JSON.stringify(data.defaultRole)})`);
      }
    }

    return { roles, errors, warnings };
  }

  _mergeSection(override, role, where, section, known, check, errors, warnings) {
    if (override[section] === undefined) return;
    if (!isPlainObject(override[section])) {
      errors.push(`roles.json: ${where}.${section} must be an object`);
      return;
    }
    for (const [key, value] of Object.entries(override[section])) {
      const keyPath = `${where}.${section}.${key}`;
      if (!(key in known)) {
        warnings.push(`roles.json: unknown ${section === 'limits' ? 'limit' : 'permission'} "${keyPath}" (ignored)`);
        continue;
      }
      const problem = check(value);
      if (problem) errors.push(`roles.json: ${keyPath} ${problem}`);
      else role[section][key] = value;
    }
  }

  // ─── Reading ──────────────────────────────────────────────────────────────

  /**
   * @param {string} key - Dotted settings key, e.g. 'registration.open'
   */
  get(key) {
    this._ensureLoaded();
    if (!(key in schema.SETTINGS)) throw new Error(`Unknown setting: ${key}`);
    return this._settings[key];
  }

  /** All settings as a nested object (a copy). */
  getSettings() {
    this._ensureLoaded();
    return nestSettings(this._settings);
  }

  /** { defaultRole, roles } with every role fully filled in. Frozen. */
  getRoles() {
    this._ensureLoaded();
    return this._roles;
  }

  // ─── Writing ──────────────────────────────────────────────────────────────

  /**
   * Validate and save changed settings. Accepts a flat ({ 'a.b': v }) or nested patch.
   * @returns {object} Diff of the keys that changed: { key: { from, to } }
   * @throws {ConfigValidationError}
   */
  updateSettings(patch) {
    this._ensureLoaded();
    const flat = flattenSettings(patch);
    const { values, errors } = this._validateSettings(flat, { unknownIsError: true, base: this._settings });
    if (errors.length) throw new ConfigValidationError(errors);

    const diff = {};
    for (const key of Object.keys(flat)) {
      if (values[key] !== this._settings[key]) diff[key] = { from: this._settings[key], to: values[key] };
    }

    this._writeAtomic(this.settingsPath, nestSettings(values));
    this._settings = values;
    if (Object.keys(diff).length) this.emit('change', { file: 'settings' });
    return diff;
  }

  _writeAtomic(filePath, data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
    fs.renameSync(tmp, filePath);
  }

  _seed() {
    if (!fs.existsSync(this.settingsPath)) {
      const values = defaultSettings();
      for (const [key, spec] of Object.entries(schema.SETTINGS)) {
        const raw = spec.env && this.env[spec.env];
        if (raw === undefined || raw === '') continue;
        const value = spec.type === 'integer' && /^\d+$/.test(raw.trim()) ? Number(raw) : raw;
        const problem = schema.checkSetting(spec, value);
        if (problem) this.logger.warn(`⚠️  Ignoring ${spec.env}=${raw}: ${key} ${problem}`);
        else values[key] = value;
      }
      this._writeAtomic(this.settingsPath, nestSettings(values));
      this.logger.log(`📝 Created ${this.settingsPath} with default settings`);
    }
    if (!fs.existsSync(this.rolesPath)) {
      this._writeAtomic(this.rolesPath, DEFAULT_ROLES);
      this.logger.log(`📝 Created ${this.rolesPath} with default roles`);
    }
  }

  // ─── Hot reload ───────────────────────────────────────────────────────────

  watch() {
    if (this._listeners) return;
    const options = { interval: this.pollIntervalMs, persistent: false };
    const onChange = (loadFn) => (curr, prev) => {
      if (curr.mtimeMs !== prev.mtimeMs || curr.size !== prev.size) loadFn();
    };
    this._listeners = {
      [this.settingsPath]: onChange(() => this._loadSettings()),
      [this.rolesPath]: onChange(() => this._loadRoles())
    };
    for (const [filePath, listener] of Object.entries(this._listeners)) fs.watchFile(filePath, options, listener);
  }

  unwatch() {
    if (!this._listeners) return;
    for (const [filePath, listener] of Object.entries(this._listeners)) fs.unwatchFile(filePath, listener);
    this._listeners = null;
  }
}

const configService = new ConfigService({
  settingsPath: paths.SETTINGS_PATH,
  rolesPath: paths.ROLES_PATH
});

module.exports = configService;
module.exports.ConfigService = ConfigService;
module.exports.ConfigValidationError = ConfigValidationError;
