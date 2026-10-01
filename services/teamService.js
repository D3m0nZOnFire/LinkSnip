const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const Team = require('../models/Team');
const RoleService = require('./roleService');
const { UPLOADS_DIR } = require('../config/paths');

/**
 * Team rules.
 *
 * Roles in a team: owner (everything, delete the team), admin (members and all items), member (creates items,
 * edits their own), viewer (sees items and analytics, changes nothing). Site admins act as owners.
 * - Owners manage anyone and give any role. Admins manage members and viewers, and give admin, member or viewer.
 * - A team always keeps an owner: the last one can't be demoted, removed or leave (a database trigger also
 *   promotes someone when the last owner's account is deleted).
 * - People outside a team don't see it: every lookup answers 404 for them.
 * - Creating a team needs the createTeams permission.
 * Functions throw TeamError (with an HTTP status); the controller logs to the audit log.
 */

const TEAM_ROLES = ['owner', 'admin', 'member', 'viewer'];
const MAX_NAME = 60;

class TeamError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'TeamError';
    this.status = status;
  }
}

const notFound = () => new TeamError(404, 'Team not found');
const canManage = (role) => role === 'owner' || role === 'admin';
// Whom a manager may change or remove, and which roles they may give
const manages = (actorRole, targetRole) => actorRole === 'owner' || (actorRole === 'admin' && ['member', 'viewer'].includes(targetRole));
const mayGive = (actorRole, role) => actorRole === 'owner' || (actorRole === 'admin' && role !== 'owner');

function cleanName(name) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > MAX_NAME) {
    throw new TeamError(400, `The team name must be 1 to ${MAX_NAME} characters`);
  }
  return name.trim();
}

function checkRole(role, allowed = TEAM_ROLES) {
  if (!allowed.includes(role)) throw new TeamError(400, `The role must be one of: ${allowed.join(', ')}`);
}

/** The team and the user's role in it (site admins: owner). 404 when the team is missing or the user isn't in it. */
function teamAs(user, teamId) {
  const team = Team.findById(Number(teamId));
  if (!team || !user) throw notFound();
  const role = Team.memberRole(team.id, user.id) || (user.isAdmin ? 'owner' : null);
  if (!role) throw notFound();
  return { team, role };
}

function managerOf(user, teamId) {
  const found = teamAs(user, teamId);
  if (!canManage(found.role)) throw new TeamError(403, 'Only team owners and admins can do that');
  return found;
}

function memberOf(team, userId) {
  const role = Team.memberRole(team.id, userId);
  if (!role) throw new TeamError(404, 'That person is not in this team');
  return role;
}

function isLastOwner(team, role) {
  return role === 'owner' && Team.ownerCount(team.id) <= 1;
}

/** A user by exact username, else by the same name in any case when only one account matches. */
function findUser(username) {
  if (typeof username !== 'string' || !username.trim()) throw new TeamError(400, 'Enter a username');
  const name = username.trim();
  const exact = db.prepare('SELECT id, username FROM users WHERE username = ?').get(name);
  if (exact) return exact;
  const matches = db.prepare('SELECT id, username FROM users WHERE username = ? COLLATE NOCASE').all(name);
  if (matches.length === 1) return matches[0];
  throw new TeamError(404, `There is no account named "${name}"`);
}

// ─── Teams ──────────────────────────────────────────────────────────────────

function create(user, name) {
  if (!user || !RoleService.can(user, 'createTeams')) throw new TeamError(403, 'Your account can\'t create teams');
  return Team.create(cleanName(name), user.id);
}

/** Everything the team page shows. */
function get(user, teamId) {
  const { team, role } = teamAs(user, teamId);
  return {
    team,
    myRole: role,
    members: Team.members(team.id),
    invites: canManage(role) ? Team.invitesForTeam(team.id) : [],
    counts: Team.itemCounts(team.id)
  };
}

function rename(user, teamId, name) {
  const { team } = managerOf(user, teamId);
  const to = cleanName(name);
  Team.rename(team.id, to);
  return { from: team.name, to };
}

/**
 * Deletes the team and everything in it, uploads included. The caller types the team's name to confirm.
 * @returns {{ name, items: { url, bundle, paste, file } }}
 */
function deleteTeam(user, teamId, confirmName) {
  const { team, role } = teamAs(user, teamId);
  if (role !== 'owner') throw new TeamError(403, 'Only team owners can delete the team');
  if (typeof confirmName !== 'string' || confirmName.trim() !== team.name) {
    throw new TeamError(400, 'Type the team name exactly to confirm');
  }

  const items = Team.itemCounts(team.id);
  const storedNames = Team.storedFileNames(team.id);
  Team.delete(team.id);
  for (const storedName of storedNames) {
    try {
      fs.rmSync(path.join(UPLOADS_DIR, path.basename(storedName)), { force: true });
    } catch (_) { /* a missing upload is fine */ }
  }
  return { name: team.name, items };
}

// ─── Members ────────────────────────────────────────────────────────────────

function memberRole(userId, teamId) {
  return Team.memberRole(Number(teamId), userId);
}

function changeRole(user, teamId, userId, role) {
  const { team, role: actorRole } = managerOf(user, teamId);
  checkRole(role);
  const from = memberOf(team, Number(userId));
  if (!manages(actorRole, from) || !mayGive(actorRole, role)) {
    throw new TeamError(403, 'Team admins can only manage members and viewers, up to admin');
  }
  if (from !== role && isLastOwner(team, from)) {
    throw new TeamError(409, 'A team needs an owner: make someone else owner first');
  }
  Team.setRole(team.id, Number(userId), role);
  const { username } = db.prepare('SELECT username FROM users WHERE id = ?').get(Number(userId));
  return { username, from, to: role };
}

function removeMember(user, teamId, userId) {
  const { team, role: actorRole } = managerOf(user, teamId);
  if (Number(userId) === user.id) throw new TeamError(400, 'To remove yourself, leave the team');
  const role = memberOf(team, Number(userId));
  if (!manages(actorRole, role)) throw new TeamError(403, 'Team admins can only remove members and viewers');
  if (isLastOwner(team, role)) throw new TeamError(409, 'A team needs an owner: make someone else owner first');
  const { username } = db.prepare('SELECT username FROM users WHERE id = ?').get(Number(userId));
  Team.removeMember(team.id, Number(userId));
  return { username, role };
}

/** Leave a team (items you created stay in it). */
function leave(user, teamId) {
  const team = Team.findById(Number(teamId));
  const role = team && user ? Team.memberRole(team.id, user.id) : null;
  if (!role) throw notFound();
  if (isLastOwner(team, role)) {
    throw new TeamError(409, 'You are the only owner: make someone else owner first, or delete the team');
  }
  Team.removeMember(team.id, user.id);
  return { role };
}

// ─── Invites ────────────────────────────────────────────────────────────────

function invite(user, teamId, username, role) {
  const { team, role: actorRole } = managerOf(user, teamId);
  if (role === 'owner') throw new TeamError(400, 'Invite as admin, member or viewer; make them owner once they joined');
  checkRole(role, ['admin', 'member', 'viewer']);
  if (!mayGive(actorRole, role)) throw new TeamError(403, 'Team admins can invite up to admin');
  const invitee = findUser(username);
  if (Team.memberRole(team.id, invitee.id)) throw new TeamError(409, `${invitee.username} is already in this team`);
  if (Team.findInviteFor(team.id, invitee.id)) throw new TeamError(409, `${invitee.username} is already invited`);
  return Team.createInvite(team.id, invitee.id, role, user.id);
}

/** An invite the user may manage (owner or admin of its team). */
function managedInvite(user, inviteId) {
  const found = Team.findInvite(Number(inviteId));
  if (!found) throw new TeamError(404, 'Invite not found');
  managerOf(user, found.teamId);
  return found;
}

function revokeInvite(user, inviteId) {
  const found = managedInvite(user, inviteId);
  Team.deleteInvite(found.id);
  return found;
}

/** An invite addressed to the user. */
function ownInvite(user, inviteId) {
  const found = Team.findInvite(Number(inviteId));
  if (!found || !user || found.userId !== user.id) throw new TeamError(404, 'Invite not found');
  return found;
}

function acceptInvite(user, inviteId) {
  const found = ownInvite(user, inviteId);
  Team.acceptInvite(found);
  return { teamId: found.teamId, teamName: found.teamName, role: found.role };
}

function declineInvite(user, inviteId) {
  const found = ownInvite(user, inviteId);
  Team.deleteInvite(found.id);
  return found;
}

// ─── Lists ──────────────────────────────────────────────────────────────────

const listForUser = (user) => Team.forUser(user.id);
const invitesForUser = (user) => Team.invitesForUser(user.id);
const listAll = () => Team.all();

module.exports = {
  TEAM_ROLES, TeamError,
  create, get, rename, deleteTeam,
  memberRole, changeRole, removeMember, leave,
  invite, revokeInvite, acceptInvite, declineInvite,
  listForUser, invitesForUser, listAll
};
