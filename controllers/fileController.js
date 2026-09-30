const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const File = require('../models/File');
const Tag = require('../models/Tag');
const User = require('../models/User');
const { logAdminAction, logAccountChange, ACTIONS } = require('../services/auditService');
const { UPLOADS_DIR } = require('../config/paths');
const AnalyticsService = require('../services/analyticsService');
const { checkAccess, sendAccessDenied, withAccessStatus } = require('../services/accessService');
const { filled, deniedPermission, deniedMessage, denyJson, tagsChanged } = require('../services/permissionGate');

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * POST /api/files/upload
 */
exports.upload = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No file uploaded' });
  }

  try {
    const { expiresAt, activateAt, deactivateAt, maxDownloads, password, sharingMode, allowedUsers, tags } = req.body;

    const denied = deniedPermission(req.user, {
      passwordProtection: filled(password),
      scheduling: filled(activateAt) || filled(deactivateAt),
      tags: filled(tags)
    });
    if (denied) {
      try { fs.unlinkSync(path.join(UPLOADS_DIR, req.file.filename)); } catch (_) {}
      return denyJson(res, denied);
    }

    let hashedPassword = null;
    if (password && password.trim()) {
      hashedPassword = await bcrypt.hash(password.trim(), 10);
    }

    let parsedAllowedUsers = [];
    if (allowedUsers) {
      try {
        parsedAllowedUsers = JSON.parse(allowedUsers);
      } catch (_) {}
    }

    const slug = File.generateUniqueSlug();

    const file = File.create({
      userId: req.user.id,
      slug,
      originalName: req.file.originalname,
      storedName: req.file.filename,
      mimeType: req.file.mimetype,
      size: req.file.size,
      expiresAt: expiresAt || null,
      activateAt: activateAt || null,
      deactivateAt: deactivateAt || null,
      maxDownloads: maxDownloads ? parseInt(maxDownloads) : null,
      password: hashedPassword,
      sharingMode: sharingMode || 'public',
      allowedUsers: parsedAllowedUsers
    });

    if (tags) {
      const tagArray = Tag.parseTagString(tags);
      Tag.attachToFile(file.id, tagArray, req.user.id);
    }

    const fileUrl = `${req.protocol}://${req.get('host')}/f/${slug}`;

    logAccountChange(ACTIONS.UPLOAD_FILE, req, {
      fileId: file.id,
      slug,
      originalName: req.file.originalname,
      size: req.file.size,
      mimeType: req.file.mimetype
    });

    return res.json({ success: true, fileUrl, slug, file });
  } catch (err) {
    // Clean up disk file if DB write failed
    if (req.file) {
      try { fs.unlinkSync(path.join(UPLOADS_DIR, req.file.filename)); } catch (_) {}
    }
    console.error('File upload error:', err);
    return res.status(500).json({ success: false, error: 'Upload failed' });
  }
};

/**
 * GET /api/files
 */
exports.list = (req, res) => {
  const files = File.findByUserId(req.user.id);
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const enriched = files.map(f => ({
    ...f,
    fileUrl: `${baseUrl}/f/${f.slug}`,
    sizeFormatted: formatBytes(f.size),
    allowedUsers: (() => { try { return JSON.parse(f.allowedUsers); } catch (_) { return []; } })()
  }));
  return res.json({ success: true, files: enriched });
};

/**
 * DELETE /api/files/:id
 */
exports.delete = (req, res) => {
  const { id } = req.params;
  const file = File.findById(parseInt(id));

  if (!file) return res.status(404).json({ error: 'File not found' });
  if (file.userId !== req.user.id && !req.user.isAdmin) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const filePath = path.join(UPLOADS_DIR, file.storedName);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (_) {}

  File.delete(file.id);

  logAccountChange(ACTIONS.DELETE_FILE, req, { fileId: file.id, slug: file.slug, originalName: file.originalName });

  return res.json({ success: true });
};

/**
 * PATCH /api/files/:id
 */
exports.updateSettings = async (req, res) => {
  const { id } = req.params;
  const file = File.findById(parseInt(id));

  if (!file) return res.status(404).json({ error: 'File not found' });
  if (file.userId !== req.user.id && !req.user.isAdmin) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const { expiresAt, activateAt, deactivateAt, maxDownloads, password, removePassword, sharingMode, allowedUsers, tags } = req.body;

    // Role features: only newly set values count; removals are always allowed
    const denied = deniedPermission(req.user, {
      passwordProtection: filled(password) && !(removePassword === '1' || removePassword === true),
      scheduling: (filled(activateAt) && activateAt !== file.activateAt) ||
                  (filled(deactivateAt) && deactivateAt !== file.deactivateAt),
      tags: tagsChanged('file', file.id, tags)
    });
    if (denied) return denyJson(res, denied);

    let newPassword = undefined;
    if (removePassword === '1' || removePassword === true) {
      newPassword = null;
    } else if (password && password.trim()) {
      newPassword = await bcrypt.hash(password.trim(), 10);
    }

    let parsedAllowedUsers = undefined;
    if (allowedUsers !== undefined) {
      try { parsedAllowedUsers = JSON.parse(allowedUsers); } catch (_) { parsedAllowedUsers = []; }
    }

    const updated = File.update(file.id, {
      expiresAt,
      activateAt,
      deactivateAt,
      maxDownloads: maxDownloads !== undefined ? (maxDownloads ? parseInt(maxDownloads) : null) : undefined,
      password: newPassword,
      sharingMode,
      allowedUsers: parsedAllowedUsers
    });

    if (tags !== undefined) {
      const tagArray = Tag.parseTagString(tags);
      Tag.attachToFile(file.id, tagArray, req.user.id);
    }

    logAccountChange(ACTIONS.UPDATE_FILE, req, { fileId: file.id, slug: file.slug });

    return res.json({ success: true, file: updated });
  } catch (err) {
    console.error('File update error:', err);
    return res.status(500).json({ error: 'Update failed' });
  }
};

// ─── Public routes ────────────────────────────────────────────────────────────

/**
 * GET /f/:slug  — download preview page
 */
exports.preview = async (req, res) => {
  const file = File.findBySlug(req.params.slug);
  if (!file) return res.status(404).render('error', { message: 'File not found', statusCode: 404 });

  const access = checkAccess(req, 'file', file);
  if (!access.allowed) return sendAccessDenied(req, res, 'file', file, access);

  const owner = User.findById(file.userId);
  const allowedUserIds = (() => { try { return JSON.parse(file.allowedUsers); } catch (_) { return []; } })();

  // Resolve allowed usernames for display
  let allowedUsernames = [];
  if (allowedUserIds.length > 0) {
    allowedUsernames = allowedUserIds.map(uid => {
      const u = User.findById(uid);
      return u ? u.username : null;
    }).filter(Boolean);
  }

  return res.render('file-download', {
    user: req.user || null,
    file,
    owner: owner || { username: 'Unknown' },
    allowedUsernames,
    sizeFormatted: formatBytes(file.size),
    downloadUrl: `/f/${file.slug}/download`
  });
};

/**
 * GET /f/:slug/download  — stream file to browser
 */
exports.download = async (req, res) => {
  const file = File.findBySlug(req.params.slug);
  if (!file) return res.status(404).render('error', { message: 'File not found', statusCode: 404 });

  const access = checkAccess(req, 'file', file);
  if (!access.allowed) return sendAccessDenied(req, res, 'file', file, access);

  const filePath = path.join(UPLOADS_DIR, file.storedName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).render('error', { message: 'File not found on disk', statusCode: 404 });
  }

  File.incrementDownloads(file.id);
  AnalyticsService.record(req, 'file', file.id).catch(() => { /* non-critical */ });

  if (file.sharingMode === 'restricted' || file.password) {
    logAccountChange(ACTIONS.DOWNLOAD_FILE, req, { fileId: file.id, slug: file.slug, originalName: file.originalName });
  }

  // The bytes are never rendered in our origin: always an attachment, and sandboxed if opened anyway
  res.set('Content-Security-Policy', 'sandbox');
  return res.download(filePath, file.originalName);
};

// ─── Admin ────────────────────────────────────────────────────────────────────

/**
 * GET /admin/files
 */
exports.adminList = (req, res) => {
  const search = req.query.search || '';
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 50;
  const offset = (page - 1) * limit;

  const files = File.findAll(limit, offset, search);
  const total = File.countAll(search);
  const totalPages = Math.ceil(total / limit);

  return res.render('admin-files', {
    user: req.user,
    files: withAccessStatus('file', files).map(f => ({ ...f, sizeFormatted: formatBytes(f.size) })),
    search,
    pagination: { page, totalPages, total, limit }
  });
};

/**
 * POST /api/admin/files/:id/block and /unblock
 */
function setBlocked(blocked) {
  return (req, res) => {
    const file = File.findById(parseInt(req.params.id));
    if (!file) return res.status(404).json({ success: false, error: 'File not found' });

    if (blocked) File.block(file.id);
    else File.unblock(file.id);

    logAdminAction(blocked ? ACTIONS.BLOCK_FILE : ACTIONS.UNBLOCK_FILE, req, 'file', file.id, file.originalName, {
      slug: file.slug,
      owner: file.userId
    });
    return res.json({ success: true });
  };
}

exports.adminBlock = setBlocked(true);
exports.adminUnblock = setBlocked(false);

/**
 * DELETE /api/admin/files/:id
 */
exports.adminDelete = (req, res) => {
  const { id } = req.params;
  const file = File.findById(parseInt(id));

  if (!file) return res.status(404).json({ error: 'File not found' });

  try {
    const filePath = path.join(UPLOADS_DIR, file.storedName);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (_) {}

  File.delete(file.id);

  logAdminAction(ACTIONS.ADMIN_DELETE_FILE, req, 'file', file.id, file.originalName, {
    slug: file.slug,
    owner: file.userId
  });

  return res.json({ success: true });
};
