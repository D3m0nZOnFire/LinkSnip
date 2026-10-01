const db = require('../config/database');
const { CONTENT_TYPES } = require('../services/contentTypes');
const Tag = require('./Tag');

/**
 * Teams, their members and pending invites (tables from migrateTeams).
 * Plain data access; the rules (who may do what) live in services/teamService.js.
 */
class Team {
  static findById(id) {
    return db.prepare('SELECT * FROM teams WHERE id = ?').get(id) || null;
  }

  static create(name, createdBy) {
    return db.transaction(() => {
      const { lastInsertRowid } = db.prepare('INSERT INTO teams (name, createdBy) VALUES (?, ?)').run(name, createdBy);
      const id = Number(lastInsertRowid);
      db.prepare("INSERT INTO team_members (teamId, userId, role) VALUES (?, ?, 'owner')").run(id, createdBy);
      return this.findById(id);
    })();
  }

  static rename(id, name) {
    db.prepare('UPDATE teams SET name = ? WHERE id = ?').run(name, id);
  }

  /** Deletes the team; its items, members, invites and tags go with it (ON DELETE CASCADE). */
  static delete(id) {
    db.prepare('DELETE FROM teams WHERE id = ?').run(id);
  }

  static memberRole(teamId, userId) {
    const row = db.prepare('SELECT role FROM team_members WHERE teamId = ? AND userId = ?').get(teamId, userId);
    return row ? row.role : null;
  }

  static members(teamId) {
    return db.prepare(`
      SELECT m.userId, u.username, m.role, m.joinedAt
      FROM team_members m JOIN users u ON u.id = m.userId
      WHERE m.teamId = ?
      ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END, u.username COLLATE NOCASE
    `).all(teamId);
  }

  static ownerCount(teamId) {
    return db.prepare("SELECT COUNT(*) AS n FROM team_members WHERE teamId = ? AND role = 'owner'").get(teamId).n;
  }

  static addMember(teamId, userId, role) {
    db.prepare('INSERT INTO team_members (teamId, userId, role) VALUES (?, ?, ?)').run(teamId, userId, role);
  }

  static setRole(teamId, userId, role) {
    db.prepare('UPDATE team_members SET role = ? WHERE teamId = ? AND userId = ?').run(role, teamId, userId);
  }

  static removeMember(teamId, userId) {
    db.prepare('DELETE FROM team_members WHERE teamId = ? AND userId = ?').run(teamId, userId);
  }

  // ─── Invites ──────────────────────────────────────────────────────────────

  static INVITE_SELECT = `
    SELECT i.id, i.teamId, t.name AS teamName, i.userId, u.username, i.role, inviter.username AS invitedBy, i.createdAt
    FROM team_invites i
    JOIN teams t ON t.id = i.teamId
    JOIN users u ON u.id = i.userId
    LEFT JOIN users inviter ON inviter.id = i.invitedBy`;

  static findInvite(id) {
    return db.prepare(`${this.INVITE_SELECT} WHERE i.id = ?`).get(id) || null;
  }

  static findInviteFor(teamId, userId) {
    return db.prepare(`${this.INVITE_SELECT} WHERE i.teamId = ? AND i.userId = ?`).get(teamId, userId) || null;
  }

  static invitesForTeam(teamId) {
    return db.prepare(`${this.INVITE_SELECT} WHERE i.teamId = ? ORDER BY i.createdAt, i.id`).all(teamId);
  }

  static invitesForUser(userId) {
    return db.prepare(`${this.INVITE_SELECT} WHERE i.userId = ? ORDER BY i.createdAt, i.id`).all(userId);
  }

  static createInvite(teamId, userId, role, invitedBy) {
    const { lastInsertRowid } = db.prepare('INSERT INTO team_invites (teamId, userId, role, invitedBy) VALUES (?, ?, ?, ?)')
      .run(teamId, userId, role, invitedBy);
    return this.findInvite(Number(lastInsertRowid));
  }

  static deleteInvite(id) {
    db.prepare('DELETE FROM team_invites WHERE id = ?').run(id);
  }

  /** Joins the team with the invite's role and removes the invite. */
  static acceptInvite(invite) {
    db.transaction(() => {
      this.addMember(invite.teamId, invite.userId, invite.role);
      this.deleteInvite(invite.id);
    })();
  }

  /** Put an item in a team (or back to personal with null). Its tags follow: same names, the new owner's set. */
  static moveItem(type, id, teamId) {
    const { table } = CONTENT_TYPES[type];
    db.transaction(() => {
      const names = Tag.forItem(type, id).map(tag => tag.name);
      db.prepare(`UPDATE ${table} SET teamId = ? WHERE id = ?`).run(teamId, id);
      Tag.setForItem(type, id, names);
    })();
  }

  // ─── Lists ────────────────────────────────────────────────────────────────

  /** { url, bundle, paste, file }: how many items the team has of each type. */
  static itemCounts(teamId) {
    const counts = {};
    for (const [type, info] of Object.entries(CONTENT_TYPES)) {
      counts[type] = db.prepare(`SELECT COUNT(*) AS n FROM ${info.table} WHERE teamId = ?`).get(teamId).n;
    }
    return counts;
  }

  /** Stored names of the team's uploads (deleted from disk with the team). */
  static storedFileNames(teamId) {
    return db.prepare('SELECT storedName FROM files WHERE teamId = ?').all(teamId).map(r => r.storedName);
  }

  static forUser(userId) {
    return db.prepare(`
      SELECT t.id, t.name, m.role, (SELECT COUNT(*) FROM team_members WHERE teamId = t.id) AS members
      FROM team_members m JOIN teams t ON t.id = m.teamId
      WHERE m.userId = ?
      ORDER BY t.name COLLATE NOCASE, t.id
    `).all(userId);
  }

  static all() {
    return db.prepare(`
      SELECT t.id, t.name, t.createdAt, creator.username AS createdBy,
        (SELECT COUNT(*) FROM team_members WHERE teamId = t.id) AS members,
        (SELECT group_concat(u.username, char(10)) FROM team_members m JOIN users u ON u.id = m.userId
          WHERE m.teamId = t.id AND m.role = 'owner') AS owners
      FROM teams t LEFT JOIN users creator ON creator.id = t.createdBy
      ORDER BY t.name COLLATE NOCASE, t.id
    `).all().map(row => ({
      ...row,
      owners: row.owners ? row.owners.split('\n').sort((a, b) => a.localeCompare(b)) : [],
      items: this.itemCounts(row.id)
    }));
  }
}

module.exports = Team;
