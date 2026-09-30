const bcrypt = require('bcrypt');
const Url = require('../models/Url');

/**
 * Accept a schedule datetime value from the client.
 * The creation form sends a full UTC ISO string (already converted by JS).
 * The edit modal (and any legacy path) may still send a raw datetime-local
 * string ("YYYY-MM-DDTHH:MM") — in that case fall back to appending Z so
 * it is at least stored consistently.
 */
function parseScheduleDate(value) {
  if (!value) return null;
  // Already a timezone-aware ISO string (ends with Z or has +HH:MM offset)
  if (value.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(value)) return value;
  // Legacy fallback: raw datetime-local → treat as UTC
  return value + ':00.000Z';
}
const SlugGenerator = require('../services/slugGenerator');
const AnalyticsService = require('../services/analyticsService');
const Tag = require('../models/Tag');
const { logAdminAction, ACTIONS } = require('../services/auditService');
const configService = require('../services/configService');
const { checkAccess, sendAccessDenied } = require('../services/accessService');
const { filled, deniedPermission, deniedMessage, denyJson, tagsChanged } = require('../services/permissionGate');

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
    const { longUrl, customSlug, maxUses, expirationDays, tags, password, activateDateTime, deactivateDateTime } = req.body;

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

    const denied = deniedPermission(req.user || null, {
      passwordProtection: filled(password),
      scheduling: filled(activateDateTime) || filled(deactivateDateTime),
      tags: filled(tags)
    });
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

      // Calculate expiration date
      let expiresAt = null;
      let finalExpirationDays = expirationDays;

      // For anonymous users, enforce expiration policy
      if (!req.user) {
        const maxAnonymousExpiration = configService.get('anonymous.urlExpirationDays');

        // If no expiration provided, use default
        if (!finalExpirationDays || isNaN(finalExpirationDays) || finalExpirationDays <= 0) {
          finalExpirationDays = maxAnonymousExpiration;
        } else {
          // Cap at maximum allowed
          finalExpirationDays = Math.min(parseInt(finalExpirationDays), maxAnonymousExpiration);
        }
      }

      if (finalExpirationDays && !isNaN(finalExpirationDays) && finalExpirationDays > 0) {
        const expirationDate = new Date();
        expirationDate.setDate(expirationDate.getDate() + parseInt(finalExpirationDays));
        expiresAt = expirationDate.toISOString();
      }

      // Parse maxUses
      const parsedMaxUses = maxUses && !isNaN(maxUses) && maxUses > 0
        ? parseInt(maxUses)
        : null;

      // Hash password if provided (role permission checked above)
      let hashedPassword = null;
      if (password && password.trim()) {
        hashedPassword = await bcrypt.hash(password, 10);
      }

      // Parse scheduling dates (role permission checked above)
      // The creation form sends UTC ISO strings; edit modal may send raw datetime-local.
      // parseScheduleDate() handles both cases.
      const activateAt   = parseScheduleDate(activateDateTime);
      const deactivateAt = parseScheduleDate(deactivateDateTime);

      // Create URL (allow anonymous creation if no user)
      const url = Url.create({
        slug,
        longUrl,
        creatorId: req.user ? req.user.id : null, // null for anonymous users
        maxUses: parsedMaxUses,
        expiresAt,
        password: hashedPassword,
        activateAt,
        deactivateAt
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
    const { longUrl, customSlug, maxUses, expirationDays, tags, password, removePassword, activateDateTime, deactivateDateTime } = req.body;

    try {
      const url = Url.findById(id);

      if (!url) {
        return res.status(404).json({ error: 'URL not found' });
      }

      // Check permissions
      if (!req.session.isAdmin && url.creatorId !== req.session.userId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Role features: only newly set values count; removals are always allowed
      const denied = deniedPermission(req.user || null, {
        passwordProtection: filled(password) && !(removePassword === 'true' || removePassword === true),
        scheduling: (filled(activateDateTime) && parseScheduleDate(activateDateTime) !== url.activateAt) ||
                    (filled(deactivateDateTime) && parseScheduleDate(deactivateDateTime) !== url.deactivateAt),
        tags: tagsChanged('url', url.id, tags)
      });
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

      // Calculate new expiration date if provided
      let expiresAt = url.expiresAt;
      if (expirationDays !== undefined) {
        if (expirationDays && !isNaN(expirationDays) && expirationDays > 0) {
          const expirationDate = new Date();
          expirationDate.setDate(expirationDate.getDate() + parseInt(expirationDays));
          expiresAt = expirationDate.toISOString();
        } else {
          expiresAt = null;
        }
      }

      const parsedMaxUses = maxUses !== undefined
        ? (maxUses && !isNaN(maxUses) && maxUses > 0 ? parseInt(maxUses) : null)
        : url.maxUses;

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

      // Handle password changes
      let hashedPassword = undefined; // undefined means don't update
      if (removePassword === 'true' || removePassword === true) {
        hashedPassword = null; // null means remove password
      } else if (password && password.trim()) {
        hashedPassword = await bcrypt.hash(password, 10);
      }

      // Parse scheduling dates
      // datetime-local format: "2025-11-21T21:16" (no timezone)
      // Append seconds and 'Z' to treat as UTC (user's input = stored time)
      let activateAt = url.activateAt;
      let deactivateAt = url.deactivateAt;
      if (activateDateTime !== undefined) {
        activateAt = parseScheduleDate(activateDateTime);
      }
      if (deactivateDateTime !== undefined) {
        deactivateAt = parseScheduleDate(deactivateDateTime);
      }

      // Update the URL with new slug if changed
      const db = require('../config/database');
      const stmt = db.prepare(`
        UPDATE urls
        SET slug = ?, longUrl = ?, maxUses = ?, expiresAt = ?, activateAt = ?, deactivateAt = ?${hashedPassword !== undefined ? ', password = ?' : ''}
        WHERE id = ?
      `);

      const params = [finalSlug, finalLongUrl, parsedMaxUses, expiresAt, activateAt, deactivateAt];
      if (hashedPassword !== undefined) {
        params.push(hashedPassword);
      }
      params.push(id);

      stmt.run(...params);

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