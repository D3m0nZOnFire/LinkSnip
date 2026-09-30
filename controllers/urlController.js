const Url = require('../models/Url');
const SlugGenerator = require('../services/slugGenerator');
const AnalyticsService = require('../services/analyticsService');
const Tag = require('../models/Tag');
const { logAdminAction, ACTIONS } = require('../services/auditService');
const { checkAccess, sendAccessDenied } = require('../services/accessService');
const { filled, deniedPermission, deniedMessage, denyJson, tagsChanged } = require('../services/permissionGate');
const { readSettings, SettingsError } = require('../services/itemSettings');

class UrlController {
  /**
   * Render URL creation form
   * GET /
   */
  static getCreateForm(req, res) {
    // Check if prefill URL was set by middleware
    let prefillUrl = req.prefillUrl || '';
    
    // If not set by middleware, check query parameter
    if (!prefillUrl && req.query.url) {
      prefillUrl = req.query.url;
    }

    res.render('index', { 
      user: req.user || null,
      prefillUrl,
      error: null,
      success: null
    });
  }

  /**
   * Create shortened URL
   * POST /create
   */
  static async createShortUrl(req, res) {
    const { longUrl, customSlug, tags } = req.body;

    // Validation
    if (!longUrl) {
      return res.render('index', {
        user: req.user || null,
        prefillUrl: '',
        error: 'Long URL is required',
        success: null
      });
    }

    // Validate URL format
    let parsedUrl;
    try {
      parsedUrl = new URL(longUrl);
    } catch (error) {
      return res.render('index', {
        user: req.user || null,
        prefillUrl: longUrl,
        error: 'Invalid URL format. Please include http:// or https://',
        success: null
      });
    }

    // Security: Only allow http and https protocols
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return res.render('index', {
        user: req.user || null,
        prefillUrl: longUrl,
        error: `Only HTTP and HTTPS URLs are allowed. Protocol "${parsedUrl.protocol}" is not supported.`,
        success: null
      });
    }

    // Expiry (with the anonymous cap), schedule, usage limit, password
    let settings;
    try {
      settings = await readSettings('url', req.body, { user: req.user || null });
    } catch (error) {
      if (!(error instanceof SettingsError)) throw error;
      return res.status(400).render('index', { user: req.user || null, prefillUrl: longUrl, error: error.message, success: null });
    }

    const denied = deniedPermission(req.user || null, { ...settings.uses, tags: filled(tags) });
    if (denied) {
      return res.status(403).render('index', {
        user: req.user || null,
        prefillUrl: longUrl,
        error: deniedMessage(denied),
        success: null
      });
    }

    try {
      // Generate or validate slug
      const { slug } = SlugGenerator.getValidSlug(customSlug || null);

      // Create URL (allow anonymous creation if no user)
      const url = Url.create({
        slug,
        longUrl,
        creatorId: req.user ? req.user.id : null, // null for anonymous users
        ...settings.values
      });

      // Attach tags if provided and user is logged in
      if (tags && req.user) {
        const tagArray = Tag.parseTagString(tags);
        Tag.attachToUrl(url.id, tagArray, req.user.id);
      }

      const shortUrl = `${req.protocol}://${req.get('host')}/s/${slug}`;

      res.render('index', {
        user: req.user || null,
        prefillUrl: '',
        error: null,
        success: {
          shortUrl,
          longUrl,
          slug
        }
      });
    } catch (error) {
      res.render('index', {
        user: req.user || null,
        prefillUrl: longUrl,
        error: error.message,
        success: null
      });
    }
  }

  /**
   * Redirect to long URL
   * GET /s/:slug
   */
  static async redirect(req, res) {
    const { slug } = req.params;

    // Find URL by slug
    const url = Url.findBySlug(slug);

    if (!url) {
      return res.status(404).render('error', {
        title: 'Not Found',
        message: 'This short URL does not exist.',
        code: 404
      });
    }

    // Blocked, scheduled, expired, used up, quarantine warning, password (no click counted)
    const access = checkAccess(req, 'url', url);
    if (!access.allowed) return sendAccessDenied(req, res, 'url', url, access);

    // Increment clicks
    Url.incrementClicks(slug);

    // Record the visit (async with geolocation)
    try {
      await AnalyticsService.record(req, 'url', url.id);
    } catch (error) {
      // Don't fail the redirect if analytics fails
      console.error('Analytics recording failed:', error);
    }

    // Perform redirect (302 for temporary, 301 for permanent)
    res.redirect(302, url.longUrl);
  }

  /**
   * Update URL (for dashboard)
   * PUT /api/urls/:id
   */
  static async updateUrl(req, res) {
    const { id } = req.params;
    const { longUrl, customSlug, tags } = req.body;

    try {
      const url = Url.findById(id);

      if (!url) {
        return res.status(404).json({ error: 'URL not found' });
      }

      // Check permissions
      if (!req.session.isAdmin && url.creatorId !== req.session.userId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Only the settings sent change; role features count only when newly set
      let settings;
      try {
        settings = await readSettings('url', req.body, { user: req.user || null, existing: url });
      } catch (error) {
        if (!(error instanceof SettingsError)) throw error;
        return res.status(400).json({ error: error.message });
      }
      const denied = deniedPermission(req.user || null, { ...settings.uses, tags: tagsChanged('url', url.id, tags) });
      if (denied) return denyJson(res, denied);

      // Handle custom slug change
      let finalSlug = url.slug; // Keep existing slug by default

      if (customSlug && customSlug !== url.slug) {
        // Validate new slug
        const SlugGenerator = require('../services/slugGenerator');

        if (!SlugGenerator.isValidSlug(customSlug)) {
          return res.status(400).json({ error: 'Invalid slug format' });
        }

        if (SlugGenerator.slugExists(customSlug)) {
          return res.status(400).json({ error: 'Slug already exists' });
        }

        finalSlug = customSlug;
      }

      // Validate new longUrl if provided
      let finalLongUrl = url.longUrl; // Keep existing by default
      if (longUrl && longUrl.trim()) {
        try {
          const parsedUrl = new URL(longUrl);
          // Security: Only allow http and https protocols
          if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
            return res.status(400).json({
              error: `Only HTTP and HTTPS URLs are allowed. Protocol "${parsedUrl.protocol}" is not supported.`
            });
          }
          finalLongUrl = longUrl;
        } catch (error) {
          return res.status(400).json({ error: 'Invalid URL format. Please include http:// or https://' });
        }
      }

      // Slug, destination and the settings that were sent
      const changes = { slug: finalSlug, longUrl: finalLongUrl, ...settings.values };
      const db = require('../config/database');
      db.prepare(`UPDATE urls SET ${Object.keys(changes).map(c => `${c} = ?`).join(', ')} WHERE id = ?`)
        .run(...Object.values(changes), id);

      // Update tags if provided
      if (tags !== undefined && req.session.userId) {
        const tagArray = Tag.parseTagString(tags);
        Tag.attachToUrl(id, tagArray, req.session.userId);
      }

      const updatedUrl = Url.findById(id);
      // Attach tags to response
      updatedUrl.tags = Tag.findByUrlId(id);
      res.json(updatedUrl);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Get single URL by ID
   * GET /api/urls/:id
   */
  static getUrlById(req, res) {
    const { id } = req.params;

    try {
      const url = Url.findById(id);

      if (!url) {
        return res.status(404).json({ error: 'URL not found' });
      }

      // Check permissions
      if (!req.session.isAdmin && url.creatorId !== req.session.userId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      res.json(url);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Delete URL (for dashboard)
   * DELETE /api/urls/:id
   */
  static deleteUrl(req, res) {
    const { id } = req.params;

    try {
      const url = Url.findById(id);

      if (!url) {
        return res.status(404).json({ error: 'URL not found' });
      }

      // Check permissions
      if (!req.session.isAdmin && url.creatorId !== req.session.userId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      Url.delete(id);

      // Log URL deletion
      logAdminAction(ACTIONS.DELETE_URL, req, 'url', url.id, `/s/${url.slug} → ${url.longUrl}`, {
        slug: url.slug,
        longUrl: url.longUrl,
        clicks: url.clicks,
        creatorId: url.creatorId
      });

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Bulk delete URLs
   * POST /api/urls/bulk-delete
   */
  static bulkDeleteUrls(req, res) {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids must be a non-empty array' });
    }
    if (ids.length > 200) {
      return res.status(400).json({ error: 'Cannot delete more than 200 URLs at once' });
    }

    let deleted = 0;
    const errors = [];

    for (const id of ids) {
      try {
        const url = Url.findById(id);
        if (!url) { errors.push(`${id}: not found`); continue; }
        if (!req.session.isAdmin && url.creatorId !== req.session.userId) {
          errors.push(`${id}: access denied`); continue;
        }
        Url.delete(id);
        logAdminAction(ACTIONS.DELETE_URL, req, 'url', url.id, `/s/${url.slug} → ${url.longUrl}`, {
          slug: url.slug, longUrl: url.longUrl, clicks: url.clicks, creatorId: url.creatorId, bulk: true
        });
        deleted++;
      } catch (err) {
        errors.push(`${id}: ${err.message}`);
      }
    }

    res.json({ success: true, deleted, errors });
  }
}

module.exports = UrlController;