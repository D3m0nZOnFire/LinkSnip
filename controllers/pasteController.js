const { canEdit } = require('../services/itemPermissions');
const Paste = require('../models/Paste');
const Tag = require('../models/Tag');
const User = require('../models/User');
const SlugGenerator = require('../services/slugGenerator');
const AnalyticsService = require('../services/analyticsService');
const { logAccountChange, ACTIONS } = require('../services/auditService');
const {
  checkAccess, sendAccessDenied, recordStatus, isLive, withAccessStatus, message: accessMessage
} = require('../services/accessService');
const { deletesInDays } = require('../services/retentionService');

const configService = require('../services/configService');
const { filled, deniedPermission, deniedMessage, denyJson, tagsChanged } = require('../services/permissionGate');
const { readSettings, SettingsError } = require('../services/itemSettings');

// Read per request so edits to settings.json apply without a restart.
const maxPasteBytes = () => configService.get('pastes.maxSizeKB') * 1024;


// ─── Create ───────────────────────────────────────────────────────────────────

/**
 * POST /api/pastes
 */
exports.create = async (req, res) => {
  try {
    const { content, title, language, customSlug, tags } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ success: false, error: 'Paste content is required' });
    }
    if (Buffer.byteLength(content, 'utf8') > maxPasteBytes()) {
      return res.status(400).json({
        success: false,
        error: `Paste is too large (max ${configService.get('pastes.maxSizeKB')} KB)`
      });
    }

    // Expiry (with the anonymous cap), schedule, view limit, password
    let settings;
    try {
      settings = await readSettings('paste', req.body, { user: req.user || null });
    } catch (error) {
      if (!(error instanceof SettingsError)) throw error;
      return res.status(400).json({ success: false, error: error.message });
    }

    const denied = deniedPermission(req.user || null, { ...settings.uses, tags: filled(tags) });
    if (denied) return denyJson(res, denied);

    // Slug
    let slug;
    if (customSlug && customSlug.trim()) {
      const candidate = customSlug.trim();
      if (!SlugGenerator.isValidSlug(candidate)) {
        return res.status(400).json({ success: false, error: 'Custom slug must be 1-20 characters (A-Z, a-z, 0-9, -, _)' });
      }
      if (Paste.slugExists(candidate)) {
        return res.status(400).json({ success: false, error: 'Custom slug already exists. Please choose another.' });
      }
      slug = candidate;
    } else {
      slug = Paste.generateUniqueSlug();
    }

    const paste = Paste.create({
      userId: req.user ? req.user.id : null,
      slug,
      title: title ? String(title).trim().substring(0, 200) : null,
      content,
      language: language ? String(language).trim().substring(0, 30) : null,
      ...settings.values
    });

    if (tags) Tag.setForItem('paste', paste.id, Tag.parseTagString(tags));

    logAccountChange(ACTIONS.CREATE_PASTE, req, { pasteId: paste.id, slug, title: paste.title });

    const pasteUrl = `${req.protocol}://${req.get('host')}/p/${slug}`;
    return res.json({ success: true, pasteUrl, slug, paste: Paste.findById(paste.id) });
  } catch (err) {
    console.error('Paste creation error:', err);
    return res.status(500).json({ success: false, error: 'Failed to create paste' });
  }
};

// ─── Owner API ────────────────────────────────────────────────────────────────

/**
 * GET /api/pastes
 */
exports.list = (req, res) => {
  const pastes = Paste.findByUserId(req.user.id);
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const enriched = pastes.map(p => ({
    ...p,
    pasteUrl: `${baseUrl}/p/${p.slug}`,
    sizeChars: p.content ? p.content.length : 0
  }));
  return res.json({ success: true, pastes: enriched });
};

/**
 * GET /api/pastes/:id
 */
exports.getById = (req, res) => {
  const paste = Paste.findById(parseInt(req.params.id));
  if (!paste) return res.status(404).json({ error: 'Paste not found' });
  if (!canEdit(req.user, 'paste', paste)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  return res.json(paste);
};

/**
 * PATCH /api/pastes/:id
 */
exports.updateSettings = async (req, res) => {
  const paste = Paste.findById(parseInt(req.params.id));
  if (!paste) return res.status(404).json({ error: 'Paste not found' });
  if (!canEdit(req.user, 'paste', paste)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const { title, language, content, tags } = req.body;

    // Only the settings sent change; role features count only when newly set
    let settings;
    try {
      settings = await readSettings('paste', req.body, { user: req.user, existing: paste });
    } catch (error) {
      if (!(error instanceof SettingsError)) throw error;
      return res.status(400).json({ error: error.message });
    }
    const denied = deniedPermission(req.user, { ...settings.uses, tags: tagsChanged('paste', paste.id, tags) });
    if (denied) return denyJson(res, denied);

    if (content !== undefined && Buffer.byteLength(String(content), 'utf8') > maxPasteBytes()) {
      return res.status(400).json({ error: `Paste is too large (max ${configService.get('pastes.maxSizeKB')} KB)` });
    }

    const updated = Paste.update(paste.id, {
      title: title !== undefined ? (title ? String(title).trim().substring(0, 200) : null) : undefined,
      language: language !== undefined ? (language ? String(language).trim().substring(0, 30) : null) : undefined,
      content: content !== undefined ? String(content) : undefined,
      ...settings.values
    });

    if (tags !== undefined) Tag.setForItem('paste', paste.id, Tag.parseTagString(tags));

    logAccountChange(ACTIONS.UPDATE_PASTE, req, { pasteId: paste.id, slug: paste.slug });

    return res.json({ success: true, paste: Paste.findById(paste.id) || updated });
  } catch (err) {
    console.error('Paste update error:', err);
    return res.status(500).json({ error: 'Update failed' });
  }
};

/**
 * DELETE /api/pastes/:id
 */
exports.delete = (req, res) => {
  const paste = Paste.findById(parseInt(req.params.id));
  if (!paste) return res.status(404).json({ error: 'Paste not found' });
  if (!canEdit(req.user, 'paste', paste)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  Paste.delete(paste.id);
  logAccountChange(ACTIONS.DELETE_PASTE, req, { pasteId: paste.id, slug: paste.slug, title: paste.title });

  return res.json({ success: true });
};

/**
 * POST /api/pastes/bulk-delete
 */
exports.bulkDelete = (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids must be a non-empty array' });
  }
  if (ids.length > 200) {
    return res.status(400).json({ error: 'Cannot delete more than 200 pastes at once' });
  }

  let deleted = 0;
  const errors = [];

  for (const id of ids) {
    try {
      const paste = Paste.findById(id);
      if (!paste) { errors.push(`${id}: not found`); continue; }
      if (!canEdit(req.user, 'paste', paste)) {
        errors.push(`${id}: access denied`); continue;
      }
      Paste.delete(id);
      logAccountChange(ACTIONS.DELETE_PASTE, req, { pasteId: paste.id, slug: paste.slug, bulk: true });
      deleted++;
    } catch (err) {
      errors.push(`${id}: ${err.message}`);
    }
  }

  return res.json({ success: true, deleted, errors });
};

// ─── Public ───────────────────────────────────────────────────────────────────

/**
 * GET /p/:slug
 */
exports.view = (req, res) => {
  const paste = Paste.findBySlug(req.params.slug);
  if (!paste) {
    return res.status(404).render('error', { title: 'Not Found', message: 'This paste does not exist.', code: 404 });
  }

  const access = checkAccess(req, 'paste', paste);
  if (!access.allowed) return sendAccessDenied(req, res, 'paste', paste, access);

  Paste.incrementViews(paste.id);

  // Record view-level analytics (async, non-blocking)
  AnalyticsService.record(req, 'paste', paste.id).catch(() => { /* non-critical */ });

  const canEdit = !!(req.user && (req.user.isAdmin || req.user.id === paste.userId));

  return res.render('paste-view', {
    user: req.user || null,
    paste,
    owner: (paste.userId && User.findById(paste.userId)) || { username: 'Anonymous' },
    lines: paste.content.split('\n'),
    sizeChars: paste.content.length,
    rawUrl: `/p/${paste.slug}/raw`,
    baseUrl: `${req.protocol}://${req.get('host')}`,
    canEdit
  });
};

/**
 * GET /pastes/:id/edit  — full-page editor (owner or admin)
 */
exports.showEditPage = (req, res) => {
  const paste = Paste.findById(parseInt(req.params.id));
  if (!paste) {
    return res.status(404).render('error', { title: 'Not Found', message: 'This paste does not exist.', code: 404 });
  }
  if (!canEdit(req.user, 'paste', paste)) {
    return res.redirect('/dashboard');
  }
  return res.render('paste-edit', { user: req.user, paste });
};

/**
 * GET /p-info/:slug  — public metadata/preview page (mirrors /info/:slug for short links)
 */
exports.showInfoPage = (req, res) => {
  const paste = Paste.findBySlug(req.params.slug);
  if (!paste) {
    return res.status(404).render('error', { title: 'Not Found', message: 'This paste does not exist.', code: 404 });
  }

  const status = recordStatus('paste', paste);
  const validation = { status, live: isLive(status), message: accessMessage('paste', status) };

  // Hide the info page for not-yet-active pastes, same as the URL info page
  if (status === 'scheduled') {
    return res.status(404).render('error', {
      title: 'Paste Not Yet Active',
      message: validation.message,
      code: 404
    });
  }

  const createdDate = new Date(paste.createdAt);
  const ageInDays = Math.floor((Date.now() - createdDate) / (1000 * 60 * 60 * 24));

  // Only preview content for a readable paste that is not password protected
  const showPreview = validation.live && !paste.password;
  const previewLines = showPreview ? paste.content.split('\n').slice(0, 12) : [];
  const previewTruncated = showPreview && paste.content.split('\n').length > 12;

  return res.render('paste-info', {
    user: req.user || null,
    paste,
    owner: (paste.userId && User.findById(paste.userId)) || { username: 'Anonymous' },
    validation,
    ageInDays,
    sizeChars: paste.content.length,
    showPreview,
    previewLines,
    previewTruncated,
    baseUrl: `${req.protocol}://${req.get('host')}`
  });
};

/**
 * GET /p/:slug/raw
 */
exports.raw = (req, res) => {
  const paste = Paste.findBySlug(req.params.slug);
  if (!paste) {
    return res.status(404).render('error', { title: 'Not Found', message: 'This paste does not exist.', code: 404 });
  }

  const access = checkAccess(req, 'paste', paste);
  if (!access.allowed) return sendAccessDenied(req, res, 'paste', paste, access);

  Paste.incrementViews(paste.id);

  res.type('text/plain; charset=utf-8');
  if (req.query.download) {
    res.setHeader('Content-Disposition', `attachment; filename="${paste.slug}.txt"`);
  }
  return res.send(paste.content);
};

// ─── Admin ────────────────────────────────────────────────────────────────────

/**
 * GET /admin/pastes
 */
exports.adminList = (req, res) => {
  const search = req.query.search || '';
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 50;
  const offset = (page - 1) * limit;

  const pastes = Paste.findAll(limit, offset, search);
  const total = Paste.countAll(search);
  const totalPages = Math.ceil(total / limit);

  return res.render('admin-pastes', {
    user: req.user,
    pastes: withAccessStatus('paste', pastes).map(p => ({ ...p, deletesInDays: deletesInDays('paste', p) })),
    search,
    pagination: { page, totalPages, total, limit }
  });
};

