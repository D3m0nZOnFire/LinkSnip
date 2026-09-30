const Tag = require('../models/Tag');
const AnalyticsEvent = require('../models/AnalyticsEvent');
const Url = require('../models/Url');
const db = require('../config/database');

class TagController {
  /**
   * Render tag management page
   * GET /tags
   */
  static getTagManagementPage(req, res) {
    try {
      const tags = Tag.getAllWithStats(req.session.userId);

      res.render('tags', {
        user: req.user,
        tags
      });
    } catch (error) {
      res.status(500).render('error', {
        title: 'Error',
        message: 'Failed to load tags',
        code: 500
      });
    }
  }

  /**
   * Get all tags for user (JSON)
   * GET /api/tags
   */
  static getAllTags(req, res) {
    try {
      const tags = Tag.getAllWithStats(req.session.userId);
      res.json(tags);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Update tag (rename or recolor)
   * PUT /api/tags/:id
   */
  static updateTag(req, res) {
    const { id } = req.params;
    const { name, color } = req.body;

    try {
      const tag = Tag.findById(id);

      if (!tag) {
        return res.status(404).json({ error: 'Tag not found' });
      }

      // Check permissions
      if (tag.userId !== req.session.userId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Validate inputs
      if (name) {
        const normalized = name.trim().toLowerCase();
        if (!normalized) {
          return res.status(400).json({ error: 'Tag name cannot be empty' });
        }

        // Check if name already exists (case-insensitive, for this user)
        const existing = Tag.findByName(normalized, req.session.userId);
        if (existing && existing.id !== parseInt(id)) {
          return res.status(400).json({ error: 'Tag name already exists' });
        }
      }

      if (color && !/^#[0-9A-F]{6}$/i.test(color)) {
        return res.status(400).json({ error: 'Invalid color format' });
      }

      Tag.update(id, { name, color });
      const updatedTag = Tag.findById(id);
      res.json(updatedTag);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Delete tag
   * DELETE /api/tags/:id
   */
  static deleteTag(req, res) {
    const { id } = req.params;

    try {
      const tag = Tag.findById(id);

      if (!tag) {
        return res.status(404).json({ error: 'Tag not found' });
      }

      // Check permissions
      if (tag.userId !== req.session.userId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      Tag.delete(id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Get tag analytics page
   * GET /tags/:id/analytics
   */
  static getTagAnalytics(req, res) {
    const { id } = req.params;

    try {
      const tag = Tag.findById(id);

      if (!tag) {
        return res.status(404).render('error', {
          title: 'Not Found',
          message: 'Tag not found',
          code: 404
        });
      }

      // Check permissions
      if (tag.userId !== req.session.userId) {
        return res.redirect('/tags');
      }

      // Get URLs with this tag
      const stmt = db.prepare(`
        SELECT u.* FROM urls u
        INNER JOIN url_tags ut ON u.id = ut.urlId
        WHERE ut.tagId = ? AND u.creatorId = ?
        ORDER BY u.createdAt DESC
      `);
      const urls = stmt.all(id, req.session.userId);

      res.render('tag-analytics', {
        user: req.user,
        tag,
        urls,
        baseUrl: `${req.protocol}://${req.get('host')}`
      });
    } catch (error) {
      res.status(500).render('error', {
        title: 'Error',
        message: 'Failed to load tag analytics',
        code: 500
      });
    }
  }

  /**
   * Get tag analytics data (JSON)
   * GET /api/tags/:id/analytics
   */
  static getTagAnalyticsData(req, res) {
    const { id } = req.params;

    try {
      const tag = Tag.findById(id);

      if (!tag) {
        return res.status(404).json({ error: 'Tag not found' });
      }

      // Check permissions
      if (tag.userId !== req.session.userId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Get URLs with this tag
      const urlStmt = db.prepare(`
        SELECT u.* FROM urls u
        INNER JOIN url_tags ut ON u.id = ut.urlId
        WHERE ut.tagId = ? AND u.creatorId = ?
      `);
      const urls = urlStmt.all(id, req.session.userId);

      if (urls.length === 0) {
        return res.json({
          totalClicks: 0,
          totalUrls: 0,
          clicksByDate: [],
          topUrls: []
        });
      }

      const urlIds = urls.map(u => u.id);

      // Total clicks
      const totalClicks = urls.reduce((sum, url) => sum + url.clicks, 0);

      // Clicks by date (last 30 days)
      const clicksByDate = AnalyticsEvent.getDailyCounts('url', urlIds, 30);

      // Top URLs by clicks
      const topUrls = urls
        .sort((a, b) => b.clicks - a.clicks)
        .slice(0, 10)
        .map(url => ({
          id: url.id,
          slug: url.slug,
          longUrl: url.longUrl,
          clicks: url.clicks
        }));

      res.json({
        totalClicks,
        totalUrls: urls.length,
        clicksByDate,
        topUrls
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
}

module.exports = TagController;
