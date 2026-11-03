const { canEdit } = require('../services/itemPermissions');
const slugService = require('../services/slugService');
const path = require('path');
const fs = require('fs');
const File = require('../models/File');
const Tag = require('../models/Tag');
const User = require('../models/User');
const { logAccountChange, ACTIONS } = require('../services/auditService');
const { UPLOADS_DIR } = require('../config/paths');
const AnalyticsService = require('../services/analyticsService');
const { checkAccess, sendAccessDenied } = require('../services/accessService');
const { sendNotFound } = require('../middleware/notFound');
const { filled, deniedPermission, deniedMessage, denyJson, tagsChanged } = require('../services/permissionGate');
const { readSettings, SettingsError } = require('../services/itemSettings');
const Team = require('../models/Team');
const teamService = require('../services/teamService');
const { isPreviewBot } = require('../services/linkPreviewBots');
const { itemShare } = require('../services/sharePreview');
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
    const { tags } = req.body;
    const discardUpload = () => { try { fs.unlinkSync(path.join(UPLOADS_DIR, req.file.filename)); } catch (_) {} };

    // Slug, expiry, schedule, download limit, password, private
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

    const { slug } = settings.values;
    const file = File.create({
      userId: req.user.id,
      originalName: req.file.originalname,
      storedName: req.file.filename,
      mimeType: req.file.mimetype,
      size: req.file.size,
      ...settings.values
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
    sizeFormatted: formatBytes(f.size)
  }));
  return res.json({ success: true, files: enriched });
};

/**
 * One file's settings for the dashboard's edit form, without the password hash.
 * GET /api/files/:id
 */
exports.get = (req, res) => {
  const file = File.findById(parseInt(req.params.id, 10));
  if (!file) return res.status(404).json({ error: 'File not found' });
  if (!canEdit(req.user, 'file', file)) return res.status(403).json({ error: 'Access denied' });

  const { password, storedName, ...rest } = file;
  return res.json({
    success: true,
    file: { ...rest, hasPassword: !!password, tags: Tag.forItem('file', file.id) }
  });
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
    const { tags } = req.body;

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

    const updated = File.update(file.id, settings.values);

    if (tags !== undefined) Tag.setForItem('file', file.id, Tag.parseTagString(tags));
    if (settings.values.slug) slugService.logChange(req, 'file', file, settings.values.slug);

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
  if (!file) return sendNotFound(req, res);

  // A one-time unlock is for the download, so this page leaves it in place
  const access = checkAccess(req, 'file', file, { keepOnce: true });
  if (!access.allowed) return sendAccessDenied(req, res, 'file', file, access);

  const owner = User.findById(file.userId);

  return res.render('file-download', {
    user: req.user || null,
    file,
    owner: owner || { username: 'Unknown' },
    sizeFormatted: formatBytes(file.size),
    downloadUrl: `/f/${file.slug}/download`,
    baseUrl: `${req.protocol}://${req.get('host')}`,
    share: itemShare('file', file, { baseUrl: `${req.protocol}://${req.get('host')}`, facts: ['File', formatBytes(file.size)] })
  });
};

/**
 * GET /f/:slug/download  — stream file to browser
 */
exports.download = async (req, res) => {
  const file = File.findBySlug(req.params.slug);
  if (!file) return sendNotFound(req, res);

  const access = checkAccess(req, 'file', file);
  if (!access.allowed) return sendAccessDenied(req, res, 'file', file, access);

  // A chat app building a link preview gets the preview page, not the file (and uses up no download)
  if (isPreviewBot(req)) return res.redirect(`/f/${file.slug}`);

  const filePath = path.join(UPLOADS_DIR, file.storedName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).render('error', { message: 'File not found on disk', statusCode: 404 });
  }

  File.incrementDownloads(file.id);
  AnalyticsService.record(req, 'file', file.id).catch(() => { /* non-critical */ });

  if (file.isPrivate || file.password) {
    logAccountChange(ACTIONS.DOWNLOAD_FILE, req, { fileId: file.id, slug: file.slug, originalName: file.originalName });
  }

  // The bytes are never rendered in our origin: always an attachment, and sandboxed if opened anyway
  res.set('Content-Security-Policy', 'sandbox');
  return res.download(filePath, file.originalName);
};

// ─── Admin ────────────────────────────────────────────────────────────────────

