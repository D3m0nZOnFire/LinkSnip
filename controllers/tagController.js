const Tag = require('../models/Tag');
const { CONTENT_TYPES, contentType, enabledTypes } = require('../services/contentTypes');

const TYPE_NOUNS = Object.fromEntries(Object.entries(CONTENT_TYPES).map(([type, info]) => [type, info.noun]));

// A tagged item with the addresses the tag analytics page links to
const withPaths = (item) => ({
  ...item,
  publicPath: `${contentType(item.type).publicPrefix}${item.slug}`,
  analyticsPath: `/analytics/${item.type}/${item.id}`
});

class TagController {
  /**
   * Render tag management page
   * GET /tags
   */
  static getTagManagementPage(req, res) {
    try {
      const tags = Tag.getAllWithStats(req.session.userId, enabledTypes());

      res.render('tags', {
        user: req.user,
        tags,
        typeNouns: TYPE_NOUNS
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
      const tags = Tag.getAllWithStats(req.session.userId, enabledTypes());
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

      res.render('tag-analytics', {
        user: req.user,
        tag,
        items: Tag.itemsFor(tag.id, enabledTypes()).map(withPaths),
        typeNouns: TYPE_NOUNS,
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

      const types = enabledTypes();
      const items = Tag.itemsFor(tag.id, types);
      const counts = Object.fromEntries(types.map(type => [type, items.filter(i => i.type === type).length]));

      res.json({
        totalItems: items.length,
        totalVisits: items.reduce((sum, item) => sum + item.visits, 0),
        counts,
        visitsByDate: Tag.dailyVisits(tag.id, types, 30),
        topItems: [...items].sort((a, b) => b.visits - a.visits).slice(0, 10).map(withPaths)
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
}

module.exports = TagController;
