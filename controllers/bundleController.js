const { canEdit, canView } = require('../services/itemPermissions');
const RoleService = require('../services/roleService');
const { isEnabled } = require('../middleware/requireFeature');
const Bundle = require('../models/Bundle');
const Tag = require('../models/Tag');
const AnalyticsService = require('../services/analyticsService');
const { logAdminAction, ACTIONS } = require('../services/auditService');
const { checkAccess, sendAccessDenied } = require('../services/accessService');
const { filled, deniedPermission, deniedMessage, denyJson, tagsChanged } = require('../services/permissionGate');
const { readSettings, SettingsError } = require('../services/itemSettings');
const Team = require('../models/Team');
const teamService = require('../services/teamService');
const { TeamError } = teamService;

const MAX_ITEMS_REGISTERED = 20;
const MAX_ITEMS_ANONYMOUS = 5;

/**
 * POST /api/bundles
 * Create a new bundle (rate limited, auth optional)
 */
async function createBundle(req, res) {
  const { title, description, customSlug, items, tags } = req.body;

  // Parse items — can arrive as JSON string or already parsed by express
  let parsedItems;
  try {
    parsedItems = typeof items === 'string' ? JSON.parse(items) : (items || []);
  } catch {
    return res.status(400).json({ error: 'Invalid items format' });
  }

  // Validate title
  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'Title is required' });
  }
  if (title.trim().length > 100) {
    return res.status(400).json({ error: 'Title must be 100 characters or less' });
  }

  // Validate items count
  const maxItems = req.user ? MAX_ITEMS_REGISTERED : MAX_ITEMS_ANONYMOUS;
  if (!Array.isArray(parsedItems) || parsedItems.length < 2) {
    return res.status(400).json({ error: 'At least 2 links are required' });
  }
  if (parsedItems.length > maxItems) {
    return res.status(400).json({ error: `Maximum ${maxItems} links allowed per bundle` });
  }

  // Validate each item URL
  for (let i = 0; i < parsedItems.length; i++) {
    const item = parsedItems[i];
    if (!item.url || !item.url.trim()) {
      return res.status(400).json({ error: `Link ${i + 1}: URL is required` });
    }
    try {
      const parsed = new URL(item.url.trim());
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return res.status(400).json({ error: `Link ${i + 1}: Only http and https URLs are allowed` });
      }
    } catch {
      return res.status(400).json({ error: `Link ${i + 1}: Invalid URL format. Please include http:// or https://` });
    }
    if (item.label && item.label.length > 100) {
      return res.status(400).json({ error: `Link ${i + 1}: Label must be 100 characters or less` });
    }
  }

  // Expiry (with the anonymous cap), schedule, usage limit, password
  let settings;
  try {
    settings = await readSettings('bundle', req.body, { user: req.user || null });
  } catch (error) {
    if (!(error instanceof SettingsError)) throw error;
    return res.status(400).json({ error: error.message });
  }

  const denied = deniedPermission(req.user || null, { ...settings.uses, tags: filled(tags) });
  if (denied) return denyJson(res, denied);

  let teamId;
  try {
    teamId = teamService.teamForNewItem(req.user || null, req.body.teamId);
  } catch (error) {
    if (!(error instanceof TeamError)) throw error;
    return res.status(error.status).json({ error: error.message });
  }

  // Generate or validate slug
  let slug;
  try {
    slug = Bundle.getValidSlug(customSlug || null);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  // Create bundle
  let bundle;
  try {
    bundle = Bundle.create({
      slug,
      title: title.trim(),
      description: description ? description.trim() : null,
      creatorId: req.user ? req.user.id : null,
      ...settings.values
    });
  } catch (err) {
    console.error('Bundle creation error:', err);
    return res.status(500).json({ error: 'Failed to create bundle' });
  }

  // Add items
  const cleanItems = parsedItems.map(item => ({
    url: item.url.trim(),
    label: item.label ? item.label.trim() : null
  }));
  Bundle.replaceItems(bundle.id, cleanItems);
  if (teamId) Team.moveItem('bundle', bundle.id, teamId);
  if (tags) Tag.setForItem('bundle', bundle.id, Tag.parseTagString(tags));

  // Audit log
  try {
    logAdminAction(ACTIONS.CREATE_BUNDLE, req, 'bundle', bundle.id,
      `/b/${bundle.slug} - "${bundle.title}"`,
      { slug: bundle.slug, title: bundle.title, itemCount: cleanItems.length, creatorId: bundle.creatorId }
    );
  } catch (e) {
    // Audit failure should not break the request
  }

  const bundleUrl = `${req.protocol}://${req.get('host')}/b/${slug}`;
  return res.status(201).json({ success: true, slug, bundleUrl, bundleId: bundle.id });
}

/**
 * GET /api/bundles/:id
 * Get a bundle with its items (authenticated, owner or admin)
 */
function getBundleById(req, res) {
  const id = parseInt(req.params.id);
  const bundle = Bundle.findByIdWithItems(id);

  if (!bundle) {
    return res.status(404).json({ error: 'Bundle not found' });
  }
  if (!canEdit(req.user, 'bundle', bundle)) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  return res.json(bundle);
}

/**
 * PUT /api/bundles/:id
 * Update bundle metadata and items (authenticated, owner or admin)
 */
async function updateBundle(req, res) {
  const id = parseInt(req.params.id);
  const bundle = Bundle.findById(id);

  if (!bundle) {
    return res.status(404).json({ error: 'Bundle not found' });
  }
  if (!canEdit(req.user, 'bundle', bundle)) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const { title, description, items, tags } = req.body;

  // Only the settings sent change (the edit form sends title, description and items);
  // role features count only when newly set
  let settings;
  try {
    settings = await readSettings('bundle', req.body, { user: req.user, existing: bundle });
  } catch (error) {
    if (!(error instanceof SettingsError)) throw error;
    return res.status(400).json({ error: error.message });
  }
  const denied = deniedPermission(req.user, { ...settings.uses, tags: tagsChanged('bundle', id, tags) });
  if (denied) return denyJson(res, denied);

  // Validate title
  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'Title is required' });
  }

  // Parse and validate items
  let parsedItems;
  try {
    parsedItems = typeof items === 'string' ? JSON.parse(items) : (items || []);
  } catch {
    return res.status(400).json({ error: 'Invalid items format' });
  }

  if (!Array.isArray(parsedItems) || parsedItems.length < 2) {
    return res.status(400).json({ error: 'At least 2 links are required' });
  }
  if (parsedItems.length > MAX_ITEMS_REGISTERED) {
    return res.status(400).json({ error: `Maximum ${MAX_ITEMS_REGISTERED} links allowed per bundle` });
  }

  for (let i = 0; i < parsedItems.length; i++) {
    const item = parsedItems[i];
    if (!item.url || !item.url.trim()) {
      return res.status(400).json({ error: `Link ${i + 1}: URL is required` });
    }
    try {
      const parsed = new URL(item.url.trim());
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return res.status(400).json({ error: `Link ${i + 1}: Only http and https URLs are allowed` });
      }
    } catch {
      return res.status(400).json({ error: `Link ${i + 1}: Invalid URL format` });
    }
  }

  const changes = { title: title.trim(), ...settings.values };
  if (Object.prototype.hasOwnProperty.call(req.body, 'description')) {
    changes.description = (description && String(description).trim()) || null;
  }
  Bundle.update(id, changes);

  const cleanItems = parsedItems.map(item => ({
    url: item.url.trim(),
    label: item.label ? item.label.trim() : null
  }));
  Bundle.replaceItems(id, cleanItems);
  if (tags !== undefined) Tag.setForItem('bundle', id, Tag.parseTagString(tags));

  try {
    logAdminAction(ACTIONS.UPDATE_BUNDLE, req, 'bundle', id,
      `/b/${bundle.slug} - "${title.trim()}"`,
      { slug: bundle.slug, title: title.trim(), itemCount: cleanItems.length }
    );
  } catch (e) { /* audit failure is non-critical */ }

  return res.json({ success: true });
}

/**
 * DELETE /api/bundles/:id
 * Delete a bundle (authenticated, owner or admin)
 */
function deleteBundle(req, res) {
  const id = parseInt(req.params.id);
  const bundle = Bundle.findById(id);

  if (!bundle) {
    return res.status(404).json({ error: 'Bundle not found' });
  }
  if (!canEdit(req.user, 'bundle', bundle)) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  Bundle.delete(id);

  try {
    logAdminAction(ACTIONS.DELETE_BUNDLE, req, 'bundle', id,
      `/b/${bundle.slug} - "${bundle.title}"`,
      { slug: bundle.slug, title: bundle.title, clicks: bundle.clicks }
    );
  } catch (e) { /* audit failure is non-critical */ }

  return res.json({ success: true });
}

/**
 * GET /b/:slug
 * Public bundle launcher page — auto-opens all URLs on load
 */
async function launchBundle(req, res) {
  const { slug } = req.params;
  const bundle = Bundle.findBySlug(slug);

  if (!bundle) {
    return res.status(404).render('error', {
      message: 'Bundle Not Found',
      error: { status: 404, stack: `No bundle found for /b/${slug}` }
    });
  }

  // Blocked, scheduled, expired, used up, quarantine warning, password
  const access = checkAccess(req, 'bundle', bundle);
  if (!access.allowed) return sendAccessDenied(req, res, 'bundle', bundle, access);

  // Remembered so this visit's item clicks (/bt) still work once this launch used up the limit
  const launched = req.session.launchedBundles || [];
  if (!launched.includes(bundle.id)) req.session.launchedBundles = [...launched, bundle.id];

  // Increment click counter
  Bundle.incrementClicks(slug);

  // Record bundle-level analytics (async, non-blocking)
  AnalyticsService.record(req, 'bundle', bundle.id).catch(() => { /* non-critical */ });

  // Load items
  const items = Bundle.getItems(bundle.id);

  // Get creator username if available
  let creatorUsername = null;
  if (bundle.creatorId) {
    try {
      const db = require('../config/database');
      const creator = db.prepare('SELECT username FROM users WHERE id = ?').get(bundle.creatorId);
      if (creator) creatorUsername = creator.username;
    } catch (e) { /* non-critical */ }
  }

  const baseUrl = `${req.protocol}://${req.get('host')}`;

  res.render('bundle-launcher', {
    user: req.user || null,
    canSeeAnalytics: !!req.user && isEnabled('analytics') && RoleService.can(req.user, 'analytics') && canView(req.user, 'bundle', bundle),
    bundle,
    items,
    creatorUsername,
    baseUrl,
    currentPage: null
  });
}

/**
 * POST /api/bundles/bulk-delete
 * Delete multiple bundles (owner or admin per item, max 200 IDs)
 */
function bulkDeleteBundles(req, res) {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids must be a non-empty array' });
  }
  if (ids.length > 200) {
    return res.status(400).json({ error: 'Cannot delete more than 200 bundles at once' });
  }

  let deleted = 0;
  const errors = [];

  for (const id of ids) {
    try {
      const bundle = Bundle.findById(id);
      if (!bundle) { errors.push(`${id}: not found`); continue; }
      if (!canEdit(req.user, 'bundle', bundle)) {
        errors.push(`${id}: access denied`); continue;
      }
      Bundle.delete(id);
      try {
        logAdminAction(ACTIONS.DELETE_BUNDLE, req, 'bundle', id,
          `/b/${bundle.slug} - "${bundle.title}"`,
          { slug: bundle.slug, title: bundle.title, bulk: true }
        );
      } catch (e) { /* audit failure is non-critical */ }
      deleted++;
    } catch (err) {
      errors.push(`${id}: ${err.message}`);
    }
  }

  return res.json({ success: true, deleted, errors });
}

module.exports = {
  createBundle,
  getBundleById,
  updateBundle,
  deleteBundle,
  bulkDeleteBundles,
  launchBundle
};
