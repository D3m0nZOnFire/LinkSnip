const { contentType } = require('./contentTypes');

/**
 * Item permissions: who may see and change one item (link, bundle, paste, file).
 *
 * Every ownership check goes through here, so the rules live in one place:
 * - canView: listing it, its analytics, opening a restricted file
 * - canEdit: editing, deleting, settings, tags, analytics share links
 *
 * Personal items (teamId NULL): the owner and admins. Anonymous items (no owner) belong to admins only.
 * Team items: decided by the role in the team, not by who created it.
 *   viewer: view · member: view, edit what they created · admin, owner: view and edit everything
 * Site admins see and edit everything.
 * Public pages (redirects, previews, downloads) don't use this: they go through accessService.
 */

// Loaded on first use: models/Team needs the database, which this module shouldn't open at require time
let Team;
const teamRole = (teamId, userId) => (Team || (Team = require('../models/Team'))).memberRole(teamId, userId);

/** The acting user of a request: req.user (read fresh from the database), else the session's IDs. */
function actor(req) {
  if (req.user) return req.user;
  const session = req.session || {};
  return session.userId ? { id: session.userId, isAdmin: !!session.isAdmin } : null;
}

function isCreator(user, type, item) {
  const ownerId = item[contentType(type).ownerColumn];
  return ownerId !== null && ownerId !== undefined && ownerId === user.id;
}

const inTeam = (item) => item.teamId !== null && item.teamId !== undefined;

/** Whether the user may see the item (and its analytics). */
function canView(user, type, item) {
  contentType(type);
  if (!user) return false;
  if (user.isAdmin) return true;
  if (inTeam(item)) return !!teamRole(item.teamId, user.id);
  return isCreator(user, type, item);
}

/** Whether the user may change or delete the item. */
function canEdit(user, type, item) {
  contentType(type);
  if (!user) return false;
  if (user.isAdmin) return true;
  if (!inTeam(item)) return isCreator(user, type, item);
  const role = teamRole(item.teamId, user.id);
  return role === 'owner' || role === 'admin' || (role === 'member' && isCreator(user, type, item));
}

/** Whether the user may move their personal item into a team (they need to be member or above there). */
function canMoveToTeam(user, type, item, teamId) {
  contentType(type);
  if (!user || inTeam(item) || !isCreator(user, type, item)) return false;
  return ['owner', 'admin', 'member'].includes(teamRole(teamId, user.id));
}

/** Whether the user may move a team item back to its creator's personal items (team owners and admins). */
function canMoveFromTeam(user, type, item) {
  const ownerId = item[contentType(type).ownerColumn];
  if (!user || !inTeam(item) || ownerId === null || ownerId === undefined) return false;
  if (user.isAdmin) return true;
  return ['owner', 'admin'].includes(teamRole(item.teamId, user.id));
}

module.exports = { actor, canView, canEdit, canMoveToTeam, canMoveFromTeam };
