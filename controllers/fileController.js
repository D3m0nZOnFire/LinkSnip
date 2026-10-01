const { canEdit } = require('../services/itemPermissions');
const path = require('path');
const fs = require('fs');
const File = require('../models/File');
const Tag = require('../models/Tag');
const User = require('../models/User');
const { logAccountChange, ACTIONS } = require('../services/auditService');
const { UPLOADS_DIR } = require('../config/paths');
const AnalyticsService = require('../services/analyticsService');
const { checkAccess, sendAccessDenied } = require('../services/accessService');
const { filled, deniedPermission, deniedMessage, denyJson, tagsChanged } = require('../services/permissionGate');
const { readSettings, SettingsError } = require('../services/itemSettings');
const Team = require('../models/Team');
const teamService = require('../services/teamService');
const { TeamError } = teamService;

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
    const { sharingMode, allowedUsers, tags } = req.body;
    const discardUpload = () => { try { fs.unlinkSync(path.join(UPLOADS_DIR, req.file.filename)); } catch (_) {} };

    // Expiry, schedule, download limit, password
    let settings;
    try {
      settings = await readSettings('file', req.body, { user: req.user });
    } catch (error) {
      if (!(error instanceof SettingsError)) throw error;
      discardUpload();
      return res.status(400).json({ success: false, error: error.message });
    }

    const denied = deniedPermission(req.user, { ...settings.uses, tags: filled(tags) });
    if (denied) {
      discardUpload();
      return denyJson(res, denied);
    }

    let teamId;
    try {
      teamId = teamService.teamForNewItem(req.user, req.body.teamId);
    } catch (error) {
      if (!(error instanceof TeamError)) throw error;
      discardUpload();
      return res.status(error.status).json({ success: false, error: error.message });
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
      ...settings.values,
      sharingMode: sharingMode || 'public',
      allowedUsers: parsedAllowedUsers
    });

    if (teamId) Team.moveItem('file', file.id, teamId);
    if (tags) Tag.setForItem('file', file.id, Tag.parseTagString(tags));

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
  if (!canEdit(req.user, 'file', file)) {
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
  if (!canEdit(req.user, 'file', file)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const { sharingMode, allowedUsers, tags } = req.body;

    // Only the settings sent change; role features count only when newly set
    let settings;
    try {
      settings = await readSettings('file', req.body, { user: req.user, existing: file });
    } catch (error) {
      if (!(error instanceof SettingsError)) throw error;
      return res.status(400).json({ error: error.message });
    }
    const denied = deniedPermission(req.user, { ...settings.uses, tags: tagsChanged('file', file.id, tags) });
    if (denied) return denyJson(res, denied);

    let parsedAllowedUsers = undefined;
    if (allowedUsers !== undefined) {
      try { parsedAllowedUsers = JSON.parse(allowedUsers); } catch (_) { parsedAllowedUsers = []; }
    }

    const updated = File.update(file.id, {
      ...settings.values,
      sharingMode,
      allowedUsers: parsedAllowedUsers
    });

    if (tags !== undefined) Tag.setForItem('file', file.id, Tag.parseTagString(tags));

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

