const db = require('../config/database');
const RoleService = require('./roleService');

/**
 * Shared rule for the optional features a create/update request can use
 * (password, scheduling, tags):
 *
 *   A request that *sets* a feature the user's role lacks is rejected with 403.
 *   Empty values are fine, and removing a password is always allowed.
 *   On update, sending back the value already stored doesn't count as setting it,
 *   so a user whose role lost a permission can still edit the rest.
 */

const FEATURE_NAMES = {
  passwordProtection: 'password protection',
  scheduling: 'scheduling',
  tags: 'tags'
};

const filled = (v) => v !== undefined && v !== null && String(v).trim() !== '';

/**
 * @param {object|null} user
 * @param {object} uses - { permissionName: boolean } for each feature the request sets
 * @returns {string|null} The first permission used but not granted
 */
function deniedPermission(user, uses) {
  for (const [permission, used] of Object.entries(uses)) {
    if (used && !RoleService.can(user, permission)) return permission;
  }
  return null;
}

function deniedMessage(permission) {
  return `Your account is not allowed to use ${FEATURE_NAMES[permission] || permission}.`;
}

function denyJson(res, permission) {
  return res.status(403).json({ error: 'permission_denied', permission, message: deniedMessage(permission) });
}

const TAG_TABLES = {
  url: ['url_tags', 'urlId'],
  paste: ['paste_tags', 'pasteId'],
  file: ['file_tags', 'fileId']
};

const normalizeTags = (names) => [...new Set(names.map(n => n.trim().toLowerCase()).filter(Boolean))].sort();

/**
 * Whether a submitted tag string differs from the tags already on the item.
 * @param {'url'|'paste'|'file'} type
 */
function tagsChanged(type, id, tagString) {
  if (!filled(tagString)) return false;
  const [table, column] = TAG_TABLES[type];
  const current = db.prepare(`SELECT t.name FROM tags t JOIN ${table} j ON j.tagId = t.id WHERE j.${column} = ?`)
    .all(id).map(r => r.name);
  return JSON.stringify(normalizeTags(String(tagString).split(','))) !== JSON.stringify(normalizeTags(current));
}

module.exports = { filled, deniedPermission, deniedMessage, denyJson, tagsChanged };
