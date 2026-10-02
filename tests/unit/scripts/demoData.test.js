const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const paths = require('../../../config/paths');
const { seedDemo, DEMO_PASSWORD } = require('../../../scripts/demoData');
const adminItems = require('../../../services/adminItems');
const { getTestDatabase } = require('../../setup/testDatabase');

/**
 * Demo data (npm run seed:demo): a filled instance to try every page with. The seeding itself runs here against
 * the test database; the command line around it runs in a child process against a temporary folder.
 */
const db = () => getTestDatabase();
const count = (sql, ...params) => db().prepare(sql).get(...params).n;

afterEach(() => {
  fs.rmSync(paths.UPLOADS_DIR, { recursive: true, force: true });
});

describe('seedDemo', () => {
  let summary;
  beforeEach(async () => {
    summary = await seedDemo({ passwordHash: '$2b$04$demo.hash.for.tests.only.xxxxxxxxxxxxxxxxxxxxxxxxxx' });
  });

  it('makes accounts of every kind, one admin among them', () => {
    expect(count('SELECT COUNT(*) AS n FROM users')).toBeGreaterThanOrEqual(7);
    expect(count('SELECT COUNT(*) AS n FROM users WHERE isAdmin = 1')).toBe(1);
    expect(count('SELECT COUNT(*) AS n FROM users WHERE isBanned = 1')).toBe(1);
    const roles = db().prepare('SELECT DISTINCT role FROM users WHERE role IS NOT NULL').all().map(r => r.role).sort();
    expect(roles).toEqual(['trusted', 'unlimited']);
    expect(summary.accounts.map(a => a.username)).toContain('admin');
  });

  it('makes items of every type, in every access status', () => {
    const { rows } = adminItems.list({ limit: null });
    expect(new Set(rows.map(r => r.type))).toEqual(new Set(['url', 'bundle', 'paste', 'file']));
    expect(new Set(rows.map(r => r.accessStatus)))
      .toEqual(new Set(['active', 'blocked', 'expired', 'scheduled', 'limit_reached', 'quarantined']));
    expect(rows.filter(r => r.hasPassword).length).toBeGreaterThan(0);
    expect(rows.filter(r => r.ownerId === null).length).toBeGreaterThan(0);
    expect(rows.filter(r => r.teamId !== null).length).toBeGreaterThan(0);
    expect(rows.filter(r => r.tags.length).length).toBeGreaterThan(0);
    expect(rows.filter(r => r.deletesInDays !== null).length).toBeGreaterThan(0);
    expect(rows.length).toBeGreaterThanOrEqual(80);
  });

  it('gives bundles their links', () => {
    expect(count('SELECT COUNT(*) AS n FROM bundles')).toBeGreaterThanOrEqual(5);
    expect(count('SELECT COUNT(*) AS n FROM bundles WHERE id NOT IN (SELECT bundleId FROM bundle_items)')).toBe(0);
  });

  it('stores the uploads of the files', () => {
    const files = db().prepare('SELECT storedName, size, allowedUsers FROM files').all();
    expect(files.length).toBeGreaterThanOrEqual(6);
    for (const file of files) {
      expect(fs.statSync(path.join(paths.UPLOADS_DIR, file.storedName)).size).toBe(file.size);
      expect(Array.isArray(JSON.parse(file.allowedUsers))).toBe(true); // as File.create stores it
    }
    expect(count("SELECT COUNT(*) AS n FROM files WHERE sharingMode = 'restricted'")).toBe(1);
  });

  it('adds a month of visits, and the counters match them', () => {
    expect(count('SELECT COUNT(*) AS n FROM analytics_events')).toBeGreaterThan(1000);
    expect(count("SELECT COUNT(DISTINCT country) AS n FROM analytics_events")).toBeGreaterThan(5);
    expect(count("SELECT COUNT(*) AS n FROM analytics_events WHERE julianday(timestamp) < julianday('now', '-20 days')")).toBeGreaterThan(0);
    const mismatched = db().prepare(`
      SELECT u.slug FROM urls u
      WHERE u.clicks <> (SELECT COUNT(*) FROM analytics_events e WHERE e.targetType = 'url' AND e.targetId = u.id)
    `).all();
    expect(mismatched).toEqual([]);
    expect(count("SELECT COUNT(*) AS n FROM analytics_events WHERE subTargetId IS NOT NULL")).toBeGreaterThan(0);
  });

  it('files reports, some pending, some handled, and quarantines what got enough', () => {
    expect(count("SELECT COUNT(*) AS n FROM reports WHERE status = 'pending'")).toBeGreaterThanOrEqual(3);
    expect(count("SELECT COUNT(*) AS n FROM reports WHERE status <> 'pending'")).toBeGreaterThan(0);
    const quarantined = db().prepare("SELECT id FROM urls WHERE isQuarantined = 1").all();
    for (const { id } of quarantined) {
      expect(count("SELECT COUNT(*) AS n FROM reports WHERE targetType = 'url' AND targetId = ? AND status = 'pending'", id)).toBeGreaterThanOrEqual(3);
    }
  });

  it('sets up teams with members, team items and an open invite', () => {
    expect(count('SELECT COUNT(*) AS n FROM teams')).toBeGreaterThanOrEqual(2);
    expect(count('SELECT COUNT(*) AS n FROM team_members')).toBeGreaterThanOrEqual(5);
    expect(count('SELECT COUNT(*) AS n FROM team_invites')).toBeGreaterThanOrEqual(1);
  });

  it('adds tags, share links, a bio page and an audit history', () => {
    expect(count('SELECT COUNT(*) AS n FROM tags')).toBeGreaterThanOrEqual(5);
    expect(count('SELECT COUNT(*) AS n FROM analytics_shares')).toBeGreaterThanOrEqual(1);
    expect(count('SELECT COUNT(*) AS n FROM bio_pages')).toBe(1);
    expect(count('SELECT COUNT(*) AS n FROM audit_logs')).toBeGreaterThanOrEqual(20);
    expect(summary.shareLink).toMatch(/^\/stats\/[A-Za-z0-9_-]+$/);
  });

  it('says how to log in', () => {
    expect(summary.accounts[0]).toEqual({ username: 'admin', password: DEMO_PASSWORD, note: expect.any(String) });
  });
});

describe('npm run seed:demo', () => {
  const script = path.join(__dirname, '../../../scripts/seed-demo.js');
  const run = (args, env = {}) => spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    timeout: 60000,
    env: { PATH: process.env.PATH, IP_HASH_SECRET: process.env.IP_HASH_SECRET, ...env }
  });

  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linksnip-demo-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('fills an empty folder and prints how to start and log in', () => {
    const target = path.join(dir, 'demo');
    const r = run([target]);
    expect(r.status).toBe(0);
    expect(fs.existsSync(path.join(target, 'database.db'))).toBe(true);
    expect(fs.readdirSync(path.join(target, 'uploads')).length).toBeGreaterThan(0);
    expect(fs.readdirSync(path.join(target, 'backups')).some(f => f.startsWith('database-backup-'))).toBe(true);
    expect(r.stdout).toContain(`DATA_DIR=${target}`);
    expect(r.stdout).toContain(DEMO_PASSWORD);
  });

  it('refuses a folder that already has a database, unless told to start over', () => {
    fs.writeFileSync(path.join(dir, 'database.db'), 'not mine to touch');
    const refused = run([dir]);
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toMatch(/already has a database.*--reset/);
    expect(fs.readFileSync(path.join(dir, 'database.db'), 'utf8')).toBe('not mine to touch');

    expect(run([dir, '--reset']).status).toBe(0);
  });

  it('never writes to the project folder (where a development database lives)', () => {
    const r = run([path.join(__dirname, '../../..'), '--reset']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/project folder/);
  });

  it('ignores DATA_DIR from the environment: the folder is always the argument (default ./demo-data)', () => {
    const target = path.join(dir, 'chosen');
    const r = run([target], { DATA_DIR: path.join(dir, 'real-instance') });
    expect(r.status).toBe(0);
    expect(fs.existsSync(path.join(dir, 'real-instance'))).toBe(false);
  });
});
