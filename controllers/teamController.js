const Team = require('../models/Team');
const teamService = require('../services/teamService');
const { TeamError } = teamService;
const RoleService = require('../services/roleService');
const { log, ACTIONS, CATEGORIES } = require('../services/auditService');

/**
 * Team pages and API. The rules are in services/teamService.js; this answers HTTP and writes the audit log:
 * an action by a team member is an account change, one by a site admin from outside the team an admin action.
 */

function logTeam(action, req, team, details, { byOutsider = false } = {}) {
  log({
    req,
    action,
    category: byOutsider ? CATEGORIES.ADMIN_ACTION : CATEGORIES.ACCOUNT_CHANGE,
    targetType: 'team',
    targetId: team.id,
    targetDescription: team.name,
    details
  });
}

// A site admin acting on a team they're not in
const isOutsider = (req, teamId) => !!req.user.isAdmin && !teamService.memberRole(req.user.id, teamId);

/** Runs an API action and answers TeamErrors as { success: false, error } with their status. */
function api(handler) {
  return (req, res) => {
    try {
      handler(req, res);
    } catch (error) {
      if (error instanceof TeamError) return res.status(error.status).json({ success: false, error: error.message });
      console.error('Team API error:', error);
      res.status(500).json({ success: false, error: 'Something went wrong' });
    }
  };
}

/** GET /teams */
exports.listPage = (req, res) => {
  res.render('teams', {
    user: req.user,
    teams: teamService.listForUser(req.user),
    invites: teamService.invitesForUser(req.user),
    canCreate: RoleService.can(req.user, 'createTeams')
  });
};

/** GET /teams/:id */
exports.teamPage = (req, res) => {
  try {
    res.render('team', { user: req.user, ...teamService.get(req.user, req.params.id), roles: teamService.TEAM_ROLES });
  } catch (error) {
    if (!(error instanceof TeamError)) throw error;
    res.status(error.status).render('error', { title: 'Not Found', message: 'This team does not exist.', code: error.status });
  }
};

/** GET /admin/teams */
exports.adminPage = (req, res) => {
  res.render('admin-teams', { user: req.user, teams: teamService.listAll() });
};

/** POST /api/teams { name } */
exports.create = api((req, res) => {
  const team = teamService.create(req.user, req.body && req.body.name);
  logTeam(ACTIONS.CREATE_TEAM, req, team, null);
  res.status(201).json({ success: true, team });
});

/** PATCH /api/teams/:id { name } */
exports.rename = api((req, res) => {
  const byOutsider = isOutsider(req, req.params.id);
  const change = teamService.rename(req.user, req.params.id, req.body && req.body.name);
  logTeam(ACTIONS.RENAME_TEAM, req, { id: Number(req.params.id), name: change.to }, change, { byOutsider });
  res.json({ success: true, name: change.to });
});

/** DELETE /api/teams/:id { confirmName } */
exports.remove = api((req, res) => {
  const byOutsider = isOutsider(req, req.params.id);
  const result = teamService.deleteTeam(req.user, req.params.id, req.body && req.body.confirmName);
  logTeam(ACTIONS.DELETE_TEAM, req, { id: Number(req.params.id), name: result.name }, { items: result.items }, { byOutsider });
  res.json({ success: true, items: result.items });
});

/** POST /api/teams/:id/invites { username, role } */
exports.invite = api((req, res) => {
  const { username, role } = req.body || {};
  const byOutsider = isOutsider(req, req.params.id);
  const invite = teamService.invite(req.user, req.params.id, username, role);
  logTeam(ACTIONS.INVITE_TEAM_MEMBER, req, { id: invite.teamId, name: invite.teamName },
    { username: invite.username, role: invite.role }, { byOutsider });
  res.status(201).json({ success: true, invite });
});

/** DELETE /api/team-invites/:id (revoke) */
exports.revokeInvite = api((req, res) => {
  const invite = teamService.revokeInvite(req.user, req.params.id);
  logTeam(ACTIONS.REVOKE_TEAM_INVITE, req, { id: invite.teamId, name: invite.teamName },
    { username: invite.username, role: invite.role }, { byOutsider: isOutsider(req, invite.teamId) });
  res.json({ success: true });
});

/** POST /api/team-invites/:id/accept */
exports.acceptInvite = api((req, res) => {
  const joined = teamService.acceptInvite(req.user, req.params.id);
  logTeam(ACTIONS.ACCEPT_TEAM_INVITE, req, { id: joined.teamId, name: joined.teamName }, { role: joined.role });
  res.json({ success: true, ...joined });
});

/** POST /api/team-invites/:id/decline */
exports.declineInvite = api((req, res) => {
  const invite = teamService.declineInvite(req.user, req.params.id);
  logTeam(ACTIONS.DECLINE_TEAM_INVITE, req, { id: invite.teamId, name: invite.teamName }, { role: invite.role });
  res.json({ success: true });
});

/** PATCH /api/teams/:id/members/:userId { role } */
exports.changeRole = api((req, res) => {
  const byOutsider = isOutsider(req, req.params.id);
  const change = teamService.changeRole(req.user, req.params.id, req.params.userId, req.body && req.body.role);
  logTeam(ACTIONS.CHANGE_TEAM_ROLE, req, teamRef(req.params.id), change, { byOutsider });
  res.json({ success: true, ...change });
});

/** DELETE /api/teams/:id/members/:userId */
exports.removeMember = api((req, res) => {
  const byOutsider = isOutsider(req, req.params.id);
  const removed = teamService.removeMember(req.user, req.params.id, req.params.userId);
  logTeam(ACTIONS.REMOVE_TEAM_MEMBER, req, teamRef(req.params.id), removed, { byOutsider });
  res.json({ success: true });
});

/** POST /api/teams/:id/leave */
exports.leave = api((req, res) => {
  const team = teamRef(req.params.id);
  const left = teamService.leave(req.user, req.params.id);
  logTeam(ACTIONS.LEAVE_TEAM, req, team, left);
  res.json({ success: true });
});

// { id, name } of a team for the audit log (the name as it is now)
function teamRef(id) {
  const team = Team.findById(Number(id));
  return { id: Number(id), name: team ? team.name : null };
}
