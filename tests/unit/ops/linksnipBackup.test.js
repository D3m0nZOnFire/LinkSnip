/**
 * docker/backup/linksnip-backup: off-site copies through rclone. The "remote" here is a local folder
 * (and once a crypt remote over one), so the tests need the rclone and sqlite3 binaries. Locally they're
 * skipped when missing; in CI they must be there.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const Database = require('better-sqlite3');

const SCRIPT = path.join(__dirname, '../../../docker/backup/linksnip-backup');
const has = bin => spawnSync('sh', ['-c', `command -v ${bin}`]).status === 0;
const toolsPresent = has('rclone') && has('sqlite3');
if (!toolsPresent && process.env.CI) throw new Error('rclone and sqlite3 are required for the backup script tests');
const describeTools = toolsPresent ? describe : describe.skip;

jest.setTimeout(60000);

let tmp, dir, data, remote, env;

function makeDb(file, rows = ['a']) {
  const db = new Database(file);
  db.exec('CREATE TABLE IF NOT EXISTS urls (slug TEXT)');
  const insert = db.prepare('INSERT INTO urls (slug) VALUES (?)');
  rows.forEach(r => insert.run(r));
  db.close();
}

function appBackup(name = 'database-backup-2026-10-01T03-00-00-000Z.sqlite', rows) {
  const file = path.join(data, 'backups', name);
  makeDb(file, rows);
  return file;
}

function run(args = [], extraEnv = {}) {
  return spawnSync('bash', [SCRIPT, ...args], { env: { ...env, ...extraEnv }, encoding: 'utf8' });
}

function backupOn(date, extraEnv = {}) {
  const r = run([], { LINKSNIP_BACKUP_DATE: date, ...extraEnv });
  if (r.status !== 0) throw new Error(`backup on ${date} failed:\n${r.stderr}`);
  return r;
}

const ls = p => (fs.existsSync(p) ? fs.readdirSync(p).sort() : []);
const read = p => fs.readFileSync(p, 'utf8');
const slugs = file => {
  const db = new Database(file, { readonly: true });
  try { return db.prepare('SELECT slug FROM urls ORDER BY slug').all().map(r => r.slug); } finally { db.close(); }
};

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'linksnip-backup-'));
  dir = path.join(tmp, 'linksnip');
  data = path.join(dir, 'data');
  remote = path.join(tmp, 'remote');
  fs.mkdirSync(path.join(data, 'backups'), { recursive: true });
  fs.mkdirSync(path.join(data, 'uploads'));
  fs.writeFileSync(path.join(dir, '.env'), 'SESSION_SECRET=s\nIP_HASH_SECRET=i\n');
  fs.writeFileSync(path.join(data, 'settings.json'), '{"s":1}');
  fs.writeFileSync(path.join(data, 'roles.json'), '{"r":1}');
  fs.writeFileSync(path.join(data, 'uploads', 'one.bin'), 'one');
  makeDb(path.join(data, 'database.db'), ['live']);
  fs.writeFileSync(path.join(tmp, 'rclone.conf'), '');
  env = {
    PATH: process.env.PATH,
    HOME: tmp,
    RCLONE_CONFIG: path.join(tmp, 'rclone.conf'),
    LINKSNIP_BACKUP_CONF: path.join(tmp, 'none.conf'),
    LINKSNIP_DIR: dir,
    LINKSNIP_BACKUP_REMOTE: remote,
    LINKSNIP_BACKUP_LOG: path.join(tmp, 'backup.log'),
    LINKSNIP_BACKUP_STATUS: path.join(tmp, 'state', 'last-success'),
    LINKSNIP_BACKUP_LOCK: path.join(tmp, 'backup.lock')
  };
});

afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describeTools('linksnip-backup', () => {
  describe('backup', () => {
    it('uploads the newest app backup, settings, roles and .env into daily/<date>/ and records the success', () => {
      appBackup('database-backup-2026-09-30T03-00-00-000Z.sqlite', ['old']);
      appBackup('database-backup-2026-10-01T03-00-00-000Z.sqlite', ['new']);
      const before = Math.floor(Date.now() / 1000);

      backupOn('2026-10-01');

      const day = path.join(remote, 'daily', '2026-10-01');
      expect(ls(day)).toEqual(['.env', 'database.sqlite', 'roles.json', 'settings.json']);
      expect(slugs(path.join(day, 'database.sqlite'))).toEqual(['new']);
      expect(read(path.join(day, '.env'))).toContain('IP_HASH_SECRET=i');
      expect(read(path.join(day, 'settings.json'))).toBe('{"s":1}');
      const recorded = Number(read(env.LINKSNIP_BACKUP_STATUS).trim());
      expect(recorded).toBeGreaterThanOrEqual(before);
      expect(read(env.LINKSNIP_BACKUP_LOG)).toMatch(/backup 2026-10-01 done/);
    });

    // Logo, favicon (Admin → Appearance) and custom palettes live in their own folders under data/
    it('copies data/branding and data/palettes into the daily copy when they exist', () => {
      appBackup('database-backup-2026-10-01T03-00-00-000Z.sqlite', ['new']);
      fs.mkdirSync(path.join(data, 'branding'));
      fs.writeFileSync(path.join(data, 'branding', 'logo.png'), 'logo');
      fs.mkdirSync(path.join(data, 'palettes'));
      fs.writeFileSync(path.join(data, 'palettes', 'company.toml'), 'mode = "dark"');

      backupOn('2026-10-01');

      const day = path.join(remote, 'daily', '2026-10-01');
      expect(ls(day)).toEqual(['.env', 'branding', 'database.sqlite', 'palettes', 'roles.json', 'settings.json']);
      expect(read(path.join(day, 'branding', 'logo.png'))).toBe('logo');
      expect(read(path.join(day, 'palettes', 'company.toml'))).toBe('mode = "dark"');
    });

    it('mirrors uploads and keeps files deleted on the server under uploads/deleted/<date>/', () => {
      appBackup();
      backupOn('2026-10-01');
      expect(read(path.join(remote, 'uploads', 'current', 'one.bin'))).toBe('one');

      fs.rmSync(path.join(data, 'uploads', 'one.bin'));
      fs.writeFileSync(path.join(data, 'uploads', 'two.bin'), 'two');
      backupOn('2026-10-02');

      expect(ls(path.join(remote, 'uploads', 'current'))).toEqual(['two.bin']);
      expect(read(path.join(remote, 'uploads', 'deleted', '2026-10-02', 'one.bin'))).toBe('one');
    });

    it('keeps the first backup of each month in monthly/<YYYY-MM>/', () => {
      appBackup('database-backup-2026-10-01T03-00-00-000Z.sqlite', ['first']);
      backupOn('2026-10-01');
      appBackup('database-backup-2026-10-02T03-00-00-000Z.sqlite', ['second']);
      backupOn('2026-10-02');

      expect(ls(path.join(remote, 'monthly'))).toEqual(['2026-10']);
      expect(slugs(path.join(remote, 'monthly', '2026-10', 'database.sqlite'))).toEqual(['first']);
      expect(slugs(path.join(remote, 'daily', '2026-10-02', 'database.sqlite'))).toEqual(['second']);
    });

    it('deletes daily copies and deleted uploads past KEEP_DAILY, monthly copies past KEEP_MONTHLY', () => {
      appBackup();
      const keep = { LINKSNIP_BACKUP_KEEP_DAILY: '3', LINKSNIP_BACKUP_KEEP_MONTHLY: '2' };
      for (const d of ['2026-08-01', '2026-09-01', '2026-09-28']) backupOn(d, keep);
      fs.rmSync(path.join(data, 'uploads', 'one.bin'));
      backupOn('2026-09-29', keep);
      backupOn('2026-10-01', keep);
      backupOn('2026-10-02', keep);

      // 3 days: 2026-09-30 .. 2026-10-02; 2 months: 2026-09, 2026-10
      expect(ls(path.join(remote, 'daily'))).toEqual(['2026-10-01', '2026-10-02']);
      expect(ls(path.join(remote, 'monthly'))).toEqual(['2026-09', '2026-10']);
      expect(ls(path.join(remote, 'uploads', 'deleted'))).toEqual([]);
    });

    it('fails without recording success when the newest app backup is too old', () => {
      const file = appBackup();
      const old = new Date(Date.now() - 30 * 3600 * 1000);
      fs.utimesSync(file, old, old);

      const r = run([], { LINKSNIP_BACKUP_DATE: '2026-10-01' });

      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/older than 26h/);
      expect(fs.existsSync(env.LINKSNIP_BACKUP_STATUS)).toBe(false);
      expect(ls(path.join(remote, 'daily'))).toEqual([]);
    });

    it('fails when there is no app backup at all', () => {
      const r = run([], { LINKSNIP_BACKUP_DATE: '2026-10-01' });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/no database backup/);
      expect(fs.existsSync(env.LINKSNIP_BACKUP_STATUS)).toBe(false);
    });

    it('fails when the app backup does not pass an integrity check', () => {
      fs.writeFileSync(path.join(data, 'backups', 'database-backup-2026-10-01T03-00-00-000Z.sqlite'), 'not a database');
      const r = run([], { LINKSNIP_BACKUP_DATE: '2026-10-01' });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/integrity/);
      expect(fs.existsSync(env.LINKSNIP_BACKUP_STATUS)).toBe(false);
    });

    it('refuses to run without a remote', () => {
      appBackup();
      const r = run([], { LINKSNIP_BACKUP_REMOTE: '' });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/LINKSNIP_BACKUP_REMOTE/);
    });

    it('reads settings from the config file; a non-empty environment variable takes precedence', () => {
      appBackup();
      const conf = path.join(tmp, 'backup.conf');
      fs.writeFileSync(conf, `# comment\nLINKSNIP_BACKUP_REMOTE=${remote}-from-conf\nLINKSNIP_BACKUP_KEEP_DAILY=not-a-number\n`);
      backupOn('2026-10-01', { LINKSNIP_BACKUP_CONF: conf, LINKSNIP_BACKUP_REMOTE: '', LINKSNIP_BACKUP_KEEP_DAILY: '30' });
      expect(ls(path.join(`${remote}-from-conf`, 'daily'))).toEqual(['2026-10-01']);
    });

    it('takes config values literally (never runs them) and rejects limits that are not whole numbers', () => {
      appBackup();
      const conf = path.join(tmp, 'backup.conf');
      fs.writeFileSync(conf, `LINKSNIP_BACKUP_KEEP_MONTHLY=$(touch ${tmp}/pwned)\n`);
      const r = run([], { LINKSNIP_BACKUP_CONF: conf, LINKSNIP_BACKUP_DATE: '2026-10-01' });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/LINKSNIP_BACKUP_KEEP_MONTHLY must be a whole number/);
      expect(fs.existsSync(path.join(tmp, 'pwned'))).toBe(false);
    });
  });

  describe('restore of branding and palettes', () => {
    it('puts data/branding and data/palettes back', () => {
      appBackup('database-backup-2026-10-01T03-00-00-000Z.sqlite', ['day1']);
      fs.mkdirSync(path.join(data, 'branding'));
      fs.writeFileSync(path.join(data, 'branding', 'favicon.ico'), 'icon');
      fs.mkdirSync(path.join(data, 'palettes'));
      fs.writeFileSync(path.join(data, 'palettes', 'company.toml'), 'mode = "dark"');
      backupOn('2026-10-01');

      const dest = path.join(tmp, 'restored-branding');
      expect(run(['restore', dest]).status).toBe(0);
      expect(read(path.join(dest, 'data', 'branding', 'favicon.ico'))).toBe('icon');
      expect(read(path.join(dest, 'data', 'palettes', 'company.toml'))).toBe('mode = "dark"');
      expect(fs.existsSync(path.join(dest, '.incoming'))).toBe(false);
    });

  });

  describe('restore', () => {
    beforeEach(() => {
      appBackup('database-backup-2026-10-01T03-00-00-000Z.sqlite', ['day1']);
      backupOn('2026-10-01');
      appBackup('database-backup-2026-10-02T03-00-00-000Z.sqlite', ['day2']);
      backupOn('2026-10-02');
    });

    it('rebuilds a LinkSnip folder (.env + data/) from the newest daily copy', () => {
      const dest = path.join(tmp, 'restored');
      const r = run(['restore', dest]);
      expect(r.status).toBe(0);

      expect(read(path.join(dest, '.env'))).toContain('SESSION_SECRET=s');
      expect(slugs(path.join(dest, 'data', 'database.db'))).toEqual(['day2']);
      expect(read(path.join(dest, 'data', 'settings.json'))).toBe('{"s":1}');
      expect(read(path.join(dest, 'data', 'roles.json'))).toBe('{"r":1}');
      expect(read(path.join(dest, 'data', 'uploads', 'one.bin'))).toBe('one');
      expect(fs.existsSync(path.join(dest, 'data', 'backups'))).toBe(true);
    });

    it('restores a given day or month', () => {
      const day = path.join(tmp, 'r-day');
      expect(run(['restore', day, '2026-10-01']).status).toBe(0);
      expect(slugs(path.join(day, 'data', 'database.db'))).toEqual(['day1']);

      const month = path.join(tmp, 'r-month');
      expect(run(['restore', month, '2026-10']).status).toBe(0);
      expect(slugs(path.join(month, 'data', 'database.db'))).toEqual(['day1']);
    });

    it('refuses a destination that is not empty, and an unknown day', () => {
      const r1 = run(['restore', dir]);
      expect(r1.status).not.toBe(0);
      expect(r1.stderr).toMatch(/not empty/);
      expect(slugs(path.join(data, 'database.db'))).toEqual(['live']);

      const r2 = run(['restore', path.join(tmp, 'x'), '2025-01-01']);
      expect(r2.status).not.toBe(0);
      expect(r2.stderr).toMatch(/no backup/);
    });
  });

  it('works through an encrypted remote: no readable names or contents, and restores', () => {
    const store = path.join(tmp, 'store');
    const obscure = p => execFileSync('rclone', ['obscure', p], { encoding: 'utf8' }).trim();
    execFileSync('rclone', ['config', 'create', 'enc', 'crypt', `remote=${store}`,
      `password=${obscure('pw')}`, `password2=${obscure('salt')}`, '--no-obscure'], { env });
    appBackup('database-backup-2026-10-01T03-00-00-000Z.sqlite', ['secret-slug']);

    backupOn('2026-10-01', { LINKSNIP_BACKUP_REMOTE: 'enc:' });

    const stored = execFileSync('find', [store], { encoding: 'utf8' });
    expect(stored).not.toMatch(/database|\.env|daily|uploads|2026/);
    const bytes = execFileSync('sh', ['-c', `cat $(find ${store} -type f)`]).toString('latin1');
    expect(bytes).not.toMatch(/IP_HASH_SECRET|secret-slug/);

    const dest = path.join(tmp, 'restored');
    expect(run(['restore', dest], { LINKSNIP_BACKUP_REMOTE: 'enc:' }).status).toBe(0);
    expect(slugs(path.join(dest, 'data', 'database.db'))).toEqual(['secret-slug']);
  });
});
