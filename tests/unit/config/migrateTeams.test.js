const Database = require('better-sqlite3');
const { migrateTeams } = require('../../../config/migrations');

const quiet = { log: () => {} };

// A database as it is before teams: users, the four content tables and tags.
function beforeTeamsDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT);
    CREATE TABLE urls (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT, creatorId INTEGER);
    CREATE TABLE bundles (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT, creatorId INTEGER);
    CREATE TABLE pastes (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT, userId INTEGER);
    CREATE TABLE files (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT, userId INTEGER);
    CREATE TABLE tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, userId INTEGER,
      UNIQUE (userId, name), FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );
    INSERT INTO users (username) VALUES ('alice'), ('bob'), ('carol'), ('dave');
    INSERT INTO urls (slug, creatorId) VALUES ('old', 1);
  `);
  return db;
}

const columns = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);

function team(db, name = 'Acme', members = [[1, 'owner']]) {
  const { lastInsertRowid: id } = db.prepare('INSERT INTO teams (name, createdBy) VALUES (?, ?)').run(name, members[0][0]);
  const add = db.prepare('INSERT INTO team_members (teamId, userId, role) VALUES (?, ?, ?)');
  for (const [userId, role] of members) add.run(id, userId, role);
  return Number(id);
}

const roleOf = (db, teamId, userId) =>
  (db.prepare('SELECT role FROM team_members WHERE teamId = ? AND userId = ?').get(teamId, userId) || {}).role;

describe('migrateTeams', () => {
  let db;
  beforeEach(() => {
    db = beforeTeamsDb();
    migrateTeams(db, quiet);
  });

  it('creates teams, team_members and team_invites', () => {
    expect(columns(db, 'teams')).toEqual(expect.arrayContaining(['id', 'name', 'createdBy', 'createdAt']));
    expect(columns(db, 'team_members')).toEqual(expect.arrayContaining(['teamId', 'userId', 'role', 'joinedAt']));
    expect(columns(db, 'team_invites')).toEqual(
      expect.arrayContaining(['id', 'teamId', 'userId', 'role', 'invitedBy', 'createdAt']));
  });

  it('adds teamId to every content table and to tags, keeping existing rows personal', () => {
    for (const table of ['urls', 'bundles', 'pastes', 'files', 'tags']) {
      expect(columns(db, table)).toContain('teamId');
    }
    expect(db.prepare("SELECT teamId FROM urls WHERE slug = 'old'").get().teamId).toBeNull();
  });

  it('runs again without changing anything', () => {
    const id = team(db);
    expect(() => migrateTeams(db, quiet)).not.toThrow();
    expect(roleOf(db, id, 1)).toBe('owner');
  });

  it('only accepts the four team roles, and admin/member/viewer for invites', () => {
    const id = team(db);
    expect(() => db.prepare("INSERT INTO team_members (teamId, userId, role) VALUES (?, 2, 'boss')").run(id)).toThrow();
    expect(() => db.prepare("INSERT INTO team_invites (teamId, userId, role) VALUES (?, 2, 'owner')").run(id)).toThrow();
    db.prepare("INSERT INTO team_invites (teamId, userId, role) VALUES (?, 2, 'viewer')").run(id);
    expect(() => db.prepare("INSERT INTO team_invites (teamId, userId, role) VALUES (?, 2, 'member')").run(id)).toThrow();
  });

  it('deleting a team deletes its items, members, invites and tags, and nothing personal', () => {
    const id = team(db, 'Acme', [[1, 'owner'], [2, 'member']]);
    db.prepare("INSERT INTO team_invites (teamId, userId, role) VALUES (?, 3, 'viewer')").run(id);
    db.prepare("INSERT INTO urls (slug, creatorId, teamId) VALUES ('t', 1, ?)").run(id);
    db.prepare("INSERT INTO bundles (slug, creatorId, teamId) VALUES ('t', 1, ?)").run(id);
    db.prepare("INSERT INTO pastes (slug, userId, teamId) VALUES ('t', 1, ?)").run(id);
    db.prepare("INSERT INTO files (slug, userId, teamId) VALUES ('t', 1, ?)").run(id);
    db.prepare("INSERT INTO tags (name, teamId) VALUES ('launch', ?)").run(id);

    db.prepare('DELETE FROM teams WHERE id = ?').run(id);

    for (const table of ['urls', 'bundles', 'pastes', 'files']) {
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE slug = 't'`).get().n).toBe(0);
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM team_members').get().n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM team_invites').get().n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM tags').get().n).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM urls WHERE slug = 'old'").get().n).toBe(1);
  });

  it('tag names are unique per team, separately from personal tags', () => {
    const a = team(db, 'A');
    const b = team(db, 'B');
    db.prepare("INSERT INTO tags (name, userId) VALUES ('launch', 1)").run();
    db.prepare("INSERT INTO tags (name, teamId) VALUES ('launch', ?)").run(a);
    db.prepare("INSERT INTO tags (name, teamId) VALUES ('launch', ?)").run(b);
    expect(() => db.prepare("INSERT INTO tags (name, teamId) VALUES ('launch', ?)").run(a)).toThrow(/UNIQUE/);
  });

  describe('a team never loses its last owner', () => {
    it('promotes the longest-standing admin when the last owner goes', () => {
      const id = team(db, 'Acme', [[1, 'owner'], [2, 'member'], [3, 'admin'], [4, 'admin']]);
      db.prepare('DELETE FROM team_members WHERE teamId = ? AND userId = 1').run(id);
      expect(roleOf(db, id, 3)).toBe('owner');
      expect(roleOf(db, id, 4)).toBe('admin');
    });

    it('without admins, the longest-standing member, then viewer', () => {
      const id = team(db, 'Acme', [[1, 'owner'], [2, 'viewer'], [3, 'member']]);
      db.prepare('DELETE FROM team_members WHERE teamId = ? AND userId = 1').run(id);
      expect(roleOf(db, id, 3)).toBe('owner');

      db.prepare('DELETE FROM team_members WHERE teamId = ? AND userId = 3').run(id);
      expect(roleOf(db, id, 2)).toBe('owner');
    });

    it('also when the owner\'s account is deleted', () => {
      const id = team(db, 'Acme', [[1, 'owner'], [2, 'member']]);
      db.prepare('DELETE FROM users WHERE id = 1').run();
      expect(roleOf(db, id, 2)).toBe('owner');
    });

    it('keeps other owners as they are', () => {
      const id = team(db, 'Acme', [[1, 'owner'], [2, 'owner'], [3, 'admin']]);
      db.prepare('DELETE FROM team_members WHERE teamId = ? AND userId = 1').run(id);
      expect(roleOf(db, id, 3)).toBe('admin');
    });

    it('leaves an empty team empty', () => {
      const id = team(db);
      db.prepare('DELETE FROM team_members WHERE teamId = ?').run(id);
      expect(db.prepare('SELECT COUNT(*) AS n FROM teams WHERE id = ?').get(id).n).toBe(1);
    });
  });
});
