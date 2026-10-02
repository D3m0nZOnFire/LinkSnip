const fs = require('fs');
const path = require('path');
const { UPLOADS_DIR } = require('../config/paths');
const { contentType, isTypeEnabled } = require('../services/contentTypes');
const { logAdminAction, ACTIONS } = require('../services/auditService');

/**
 * Admin block, unblock and delete for every content type (/api/admin/:type/…).
 * Audit action names are per type, as before: BLOCK_URL, UNBLOCK_PASTE, ADMIN_DELETE_FILE, …
 */

const MODELS = {
  url: () => require('../models/Url'),
  bundle: () => require('../models/Bundle'),
  paste: () => require('../models/Paste'),
  file: () => require('../models/File')
};
const AUDIT_NAME = { url: 'URL', bundle: 'BUNDLE', paste: 'PASTE', file: 'FILE' };
const MAX_BULK = 200;

// What the audit log shows: the public address, and the destination when there is one
function describe(type, item) {
  const { publicPrefix, destination } = contentType(type);
  const where = `${publicPrefix}${item.slug}`;
  return item[destination] ? `${where} → ${item[destination]}` : where;
}

const ownerOf = (type, item) => item[contentType(type).ownerColumn] ?? null;

/** Route guard: an unknown type, or one whose feature is off, falls through (404). */
function knownType(req, res, next) {
  return isTypeEnabled(req.params.type) ? next() : next('route');
}

function setBlocked(blocked) {
  const verb = blocked ? 'BLOCK' : 'UNBLOCK';
  return (req, res) => {
    const { type } = req.params;
    const Model = MODELS[type]();
    const item = Model.findById(parseInt(req.params.id, 10));
    if (!item) return res.status(404).json({ error: `${contentType(type).noun} not found` });

    if (blocked) Model.block(item.id);
    else Model.unblock(item.id);
    logAdminAction(ACTIONS[`${verb}_${AUDIT_NAME[type]}`], req, type, item.id, describe(type, item), {
      slug: item.slug, owner: ownerOf(type, item), manual: true
    });
    return res.json({ success: true });
  };
}

function remove(req, res) {
  const { type } = req.params;
  const Model = MODELS[type]();
  const item = Model.findById(parseInt(req.params.id, 10));
  if (!item) return res.status(404).json({ error: `${contentType(type).noun} not found` });

  if (type === 'file') {
    // basename: a stored name never leads outside the uploads folder
    fs.rmSync(path.join(UPLOADS_DIR, path.basename(item.storedName)), { force: true });
  }
  Model.delete(item.id);
  logAdminAction(ACTIONS[`ADMIN_DELETE_${AUDIT_NAME[type]}`], req, type, item.id, describe(type, item), {
    slug: item.slug, owner: ownerOf(type, item)
  });
  return res.json({ success: true });
}

function bulkSetBlocked(blocked) {
  const verb = blocked ? 'BLOCK' : 'UNBLOCK';
  const countKey = blocked ? 'blocked' : 'unblocked';
  return (req, res) => {
    const { type } = req.params;
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids must be a non-empty array' });
    }
    if (ids.length > MAX_BULK) {
      return res.status(400).json({ error: `Cannot change more than ${MAX_BULK} items at once` });
    }

    const Model = MODELS[type]();
    let count = 0;
    const errors = [];
    for (const id of ids) {
      try {
        const item = Model.findById(parseInt(id, 10));
        if (!item) { errors.push(`${id}: not found`); continue; }
        if (blocked) Model.block(item.id);
        else Model.unblock(item.id);
        logAdminAction(ACTIONS[`${verb}_${AUDIT_NAME[type]}`], req, type, item.id, describe(type, item), {
          slug: item.slug, owner: ownerOf(type, item), manual: true, bulk: true
        });
        count++;
      } catch (err) {
        errors.push(`${id}: ${err.message}`);
      }
    }
    return res.json({ success: true, [countKey]: count, errors });
  };
}

/**
 * POST /api/admin/:type/bulk-delete { ids }: each one deleted and logged like a single delete
 */
function bulkRemove(req, res) {
  const { type } = req.params;
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids must be a non-empty array' });
  }
  if (ids.length > MAX_BULK) {
    return res.status(400).json({ error: `Cannot delete more than ${MAX_BULK} items at once` });
  }

  const Model = MODELS[type]();
  let deleted = 0;
  const errors = [];
  for (const id of ids) {
    try {
      const item = Model.findById(parseInt(id, 10));
      if (!item) { errors.push(`${id}: not found`); continue; }
      if (type === 'file') fs.rmSync(path.join(UPLOADS_DIR, path.basename(item.storedName)), { force: true });
      Model.delete(item.id);
      logAdminAction(ACTIONS[`ADMIN_DELETE_${AUDIT_NAME[type]}`], req, type, item.id, describe(type, item), {
        slug: item.slug, owner: ownerOf(type, item), bulk: true
      });
      deleted++;
    } catch (err) {
      errors.push(`${id}: ${err.message}`);
    }
  }
  return res.json({ success: true, deleted, errors });
}

module.exports = {
  knownType,
  block: setBlocked(true),
  unblock: setBlocked(false),
  remove,
  bulkBlock: bulkSetBlocked(true),
  bulkUnblock: bulkSetBlocked(false),
  bulkRemove
};
