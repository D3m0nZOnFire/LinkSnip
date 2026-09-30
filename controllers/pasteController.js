const bcrypt = require('bcrypt');
const Paste = require('../models/Paste');
const PasteAnalytics = require('../models/PasteAnalytics');
const Tag = require('../models/Tag');
const User = require('../models/User');
const SlugGenerator = require('../services/slugGenerator');
const QRCodeService = require('../services/qrcodeService');
const AnalyticsService = require('../services/analyticsService');
const { logAdminAction, logAccountChange, ACTIONS } = require('../services/auditService');
const {
  checkAccess, sendAccessDenied, recordStatus, isLive, withAccessStatus, message: accessMessage
} = require('../services/accessService');
const { deletesInDays } = require('../services/retentionService');

const configService = require('../services/configService');
const { filled, deniedPermission, deniedMessage, denyJson, tagsChanged } = require('../services/permissionGate');

// Read per request so edits to settings.json apply without a restart.
const maxPasteBytes = () => configService.get('pastes.maxSizeKB') * 1024;

/**
 * Accept a schedule datetime value from the client.
 * The creation form sends a full UTC ISO string (already converted by JS).
 * The edit modal may still send a raw datetime-local string ("YYYY-MM-DDTHH:MM")
 * — in that case append Z so it is at least stored consistently.
 */
function parseScheduleDate(value) {
  if (!value) return null;
  if (value.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(value)) return value;
  return value + ':00.000Z';
}

// ─── Create ───────────────────────────────────────────────────────────────────

/**
 * POST /api/pastes
 */
exports.create = async (req, res) => {
  try {
    const {
      content, title, language, customSlug, expiresAt, expirationDays,
      maxViews, password, tags, activateDateTime, deactivateDateTime
    } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ success: false, error: 'Paste content is required' });
    }
    if (Buffer.byteLength(content, 'utf8') > maxPasteBytes()) {
      return res.status(400).json({
        success: false,
        error: `Paste is too large (max ${configService.get('pastes.maxSizeKB')} KB)`
      });
    }

    const denied = deniedPermission(req.user || null, {
      passwordProtection: filled(password),
      scheduling: filled(activateDateTime) || filled(deactivateDateTime),
      tags: filled(tags)
    });
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

    // Expiration — candidate first, then enforce the anonymous cap
    let finalExpiresAt = null;
    if (expirationDays && !isNaN(expirationDays) && parseInt(expirationDays) > 0) {
      const d = new Date();
      d.setDate(d.getDate() + parseInt(expirationDays));
      finalExpiresAt = d.toISOString();
    } else if (expiresAt) {
      const parsed = new Date(expiresAt);
      if (!isNaN(parsed.getTime())) finalExpiresAt = parsed.toISOString();
    }

    if (!req.user) {
      const cap = new Date();
      cap.setDate(cap.getDate() + configService.get('anonymous.pasteExpirationDays'));
      if (!finalExpiresAt || new Date(finalExpiresAt) > cap) {
        finalExpiresAt = cap.toISOString();
      }
    }

    // Password / scheduling — role permission checked above
    let hashedPassword = null;
    if (password && password.trim()) {
      hashedPassword = await bcrypt.hash(password.trim(), 10);
    }

    const activateAt = parseScheduleDate(activateDateTime);
    const deactivateAt = parseScheduleDate(deactivateDateTime);

    const parsedMaxViews = maxViews && !isNaN(maxViews) && parseInt(maxViews) > 0 ? parseInt(maxViews) : null;

    const paste = Paste.create({
      userId: req.user ? req.user.id : null,
      slug,
      title: title ? String(title).trim().substring(0, 200) : null,
      content,
      language: language ? String(language).trim().substring(0, 30) : null,
      expiresAt: finalExpiresAt,
      activateAt,
      deactivateAt,
      maxViews: parsedMaxViews,
      password: hashedPassword
    });

    if (tags && req.user) {
      const tagArray = Tag.parseTagString(tags);
      Tag.attachToPaste(paste.id, tagArray, req.user.id);
    }

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
  if (paste.userId !== req.user.id && !req.user.isAdmin) {
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
  if (paste.userId !== req.user.id && !req.user.isAdmin) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const {
      title, language, content, expiresAt, activateAt, deactivateAt,
      maxViews, password, removePassword, tags
    } = req.body;

    // Role features: only newly set values count; removals are always allowed
    const denied = deniedPermission(req.user, {
      passwordProtection: filled(password) && !(removePassword === '1' || removePassword === true),
      scheduling: (filled(activateAt) && parseScheduleDate(activateAt) !== paste.activateAt) ||
                  (filled(deactivateAt) && parseScheduleDate(deactivateAt) !== paste.deactivateAt),
      tags: tagsChanged('paste', paste.id, tags)
    });
    if (denied) return denyJson(res, denied);

    if (content !== undefined && Buffer.byteLength(String(content), 'utf8') > maxPasteBytes()) {
      return res.status(400).json({ error: `Paste is too large (max ${configService.get('pastes.maxSizeKB')} KB)` });
    }

    let newPassword = undefined;
    if (removePassword === '1' || removePassword === true) {
      newPassword = null;
    } else if (password && password.trim()) {
      newPassword = await bcrypt.hash(password.trim(), 10);
    }

    const updated = Paste.update(paste.id, {
      title: title !== undefined ? (title ? String(title).trim().substring(0, 200) : null) : undefined,
      language: language !== undefined ? (language ? String(language).trim().substring(0, 30) : null) : undefined,
      content: content !== undefined ? String(content) : undefined,
      expiresAt: expiresAt !== undefined ? (expiresAt || null) : undefined,
      activateAt: activateAt !== undefined ? parseScheduleDate(activateAt) : undefined,
      deactivateAt: deactivateAt !== undefined ? parseScheduleDate(deactivateAt) : undefined,
      maxViews: maxViews !== undefined ? (maxViews ? parseInt(maxViews) : null) : undefined,
      password: newPassword
    });

    if (tags !== undefined) {
      const tagArray = Tag.parseTagString(tags);
      Tag.attachToPaste(paste.id, tagArray, paste.userId || req.user.id);
    }

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
  if (paste.userId !== req.user.id && !req.user.isAdmin) {
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
      if (paste.userId !== req.user.id && !req.user.isAdmin) {
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
  AnalyticsService.captureAnalytics(req, paste.id).then(data => {
    const { urlId, ...rest } = data;
    PasteAnalytics.record({ pasteId: paste.id, ...rest });
  }).catch(() => { /* non-critical */ });

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
  if (paste.userId !== req.user.id && !req.user.isAdmin) {
    return res.redirect('/dashboard');
  }
  return res.render('paste-edit', { user: req.user, paste });
};

/**
 * GET /pastes/:id/analytics  — full-page analytics (owner or admin)
 */
exports.showAnalyticsPage = (req, res) => {
  const paste = Paste.findById(parseInt(req.params.id));
  if (!paste) {
    return res.status(404).render('error', { title: 'Not Found', message: 'This paste does not exist.', code: 404 });
  }
  if (paste.userId !== req.user.id && !req.user.isAdmin) {
    return res.redirect('/dashboard');
  }

  const analytics = PasteAnalytics.getSummary(paste.id);
  const owner = (paste.userId && User.findById(paste.userId)) || { username: 'Anonymous' };

  return res.render('paste-analytics', {
    user: req.user,
    paste,
    owner,
    analytics,
    sizeChars: paste.content ? paste.content.length : 0,
    baseUrl: `${req.protocol}://${req.get('host')}`,
    currentPage: 'dashboard'
  });
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

/**
 * DELETE /api/admin/pastes/:id
 */
exports.adminDelete = (req, res) => {
  const paste = Paste.findById(parseInt(req.params.id));
  if (!paste) return res.status(404).json({ error: 'Paste not found' });

  Paste.delete(paste.id);
  logAdminAction(ACTIONS.ADMIN_DELETE_PASTE, req, 'paste', paste.id, paste.title || paste.slug, {
    slug: paste.slug,
    owner: paste.userId
  });

  return res.json({ success: true });
};

/**
 * POST /api/admin/pastes/:id/block
 */
exports.blockPaste = (req, res) => {
  const paste = Paste.findById(parseInt(req.params.id));
  if (!paste) return res.status(404).json({ error: 'Paste not found' });

  Paste.block(paste.id);
  logAdminAction(ACTIONS.BLOCK_PASTE, req, 'paste', paste.id, `/p/${paste.slug}`, { slug: paste.slug, manual: true });

  return res.json({ success: true, message: 'Paste blocked successfully' });
};

/**
 * POST /api/admin/pastes/:id/unblock
 */
exports.unblockPaste = (req, res) => {
  const paste = Paste.findById(parseInt(req.params.id));
  if (!paste) return res.status(404).json({ error: 'Paste not found' });

  Paste.unblock(paste.id);
  logAdminAction(ACTIONS.UNBLOCK_PASTE, req, 'paste', paste.id, `/p/${paste.slug}`, { slug: paste.slug, manual: true });

  return res.json({ success: true, message: 'Paste unblocked successfully' });
};

// ─── QR codes ─────────────────────────────────────────────────────────────────

async function resolveQrTarget(req) {
  const paste = Paste.findBySlug(req.params.slug);
  if (!paste) return null;
  return { paste, target: `${req.protocol}://${req.get('host')}/p/${paste.slug}` };
}

/**
 * GET /qrcode/paste/:slug
 */
exports.qr = async (req, res) => {
  const { format = 'png', theme = 'light' } = req.query;
  try {
    const resolved = await resolveQrTarget(req);
    if (!resolved) return res.status(404).json({ error: 'Paste not found' });

    if (format === 'svg') {
      const svg = await QRCodeService.generateSVG(resolved.target);
      res.setHeader('Content-Type', 'image/svg+xml');
      return res.send(svg);
    }

    const buffer = await QRCodeService.generateBuffer(resolved.target, {
      color: theme === 'dark' ? { dark: '#34d399', light: '#0a0a0a' } : undefined
    });
    res.setHeader('Content-Type', 'image/png');
    res.send(buffer);
  } catch (error) {
    console.error('Paste QR generation error:', error);
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
};

/**
 * GET /qrcode/paste/:slug/download
 */
exports.qrDownload = async (req, res) => {
  const { format = 'png', theme = 'light' } = req.query;
  try {
    const resolved = await resolveQrTarget(req);
    if (!resolved) return res.status(404).json({ error: 'Paste not found' });

    const filename = `qrcode-${resolved.paste.slug}.${format === 'svg' ? 'svg' : 'png'}`;

    if (format === 'svg') {
      const svg = await QRCodeService.generateSVG(resolved.target);
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(svg);
    }

    const buffer = await QRCodeService.generateBuffer(resolved.target, {
      color: theme === 'dark' ? { dark: '#34d399', light: '#0a0a0a' } : undefined,
      width: 1024
    });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error) {
    console.error('Paste QR download error:', error);
    res.status(500).json({ error: 'Failed to download QR code' });
  }
};

/**
 * GET /api/qrcode/paste/:slug/dataurl
 */
exports.qrDataUrl = async (req, res) => {
  const { theme = 'light' } = req.query;
  try {
    const resolved = await resolveQrTarget(req);
    if (!resolved) return res.status(404).json({ error: 'Paste not found' });

    const dataURL = await QRCodeService.generateThemedDataURL(resolved.target, theme);
    res.json({ dataURL, infoUrl: resolved.target });
  } catch (error) {
    console.error('Paste QR data URL error:', error);
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
};
