const { contentType } = require('./contentTypes');

/**
 * Item permissions: who may see and change one item (link, bundle, paste, file).
 *
 * Every ownership check goes through here, so the rule lives in one place:
 * - canView: listing it as one's own, its analytics
 * - canEdit: editing, deleting, settings, tags, analytics share links
 * Today both mean "the owner or an admin". Anonymous items (no owner) belong to admins only.
 * Public pages (redirects, previews, downloads) don't use this: they go through accessService.
 */

/** The acting user of a request: req.user (read fresh from the database), else the session's IDs. */
function actor(req) {
  if (req.user) return req.user;
  const session = req.session || {};
  return session.userId ? { id: session.userId, isAdmin: !!session.isAdmin } : null;
}

function isOwner(user, type, item) {
  const ownerId = item[contentType(type).ownerColumn];
  return ownerId !== null && ownerId !== undefined && ownerId === user.id;
}

/** Whether the user may see the item as theirs (and its analytics). */
function canView(user, type, item) {
  return canEdit(user, type, item);
}

/** Whether the user may change or delete the item. */
function canEdit(user, type, item) {
  contentType(type);
  if (!user) return false;
  return !!user.isAdmin || isOwner(user, type, item);
}

module.exports = { actor, canView, canEdit };
