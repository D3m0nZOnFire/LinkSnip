const BioPage = require('../models/BioPage');
const RoleService = require('../services/roleService');
const User = require('../models/User');
const Url = require('../models/Url');
const { recordStatus, isLive } = require('../services/accessService');

class BioPageController {
  /**
   * Public bio page view
   * GET /bio/:username
   */
  static getBioPage(req, res) {
    const { username } = req.params;

    try {
      // Find user
      const user = User.findByUsername(username);

      if (!user) {
        return res.status(404).render('error', {
          title: 'User Not Found',
          message: 'The user you are looking for does not exist.',
          code: 404
        });
      }

      // Find bio page (hidden when the owner's role doesn't allow one)
      const bioPage = RoleService.can(user, 'bioPage') ? BioPage.findByUserId(user.id) : null;

      if (!bioPage) {
        return res.status(404).render('error', {
          title: 'Bio Page Not Found',
          message: `${username} hasn't set up their bio page yet.`,
          code: 404
        });
      }

      // Only links that are available (password-protected and reported ones still show)
      const urls = BioPage.getUrls(bioPage.id).filter(url => isLive(recordStatus('url', url)));

      res.render('bio-page', {
        bioPage,
        username,
        urls,
        socialLinks: bioPage.socialLinks || [],
        baseUrl: `${req.protocol}://${req.get('host')}`,
        user: req.user || null  // For header
      });

    } catch (error) {
      console.error('Bio page error:', error);
      res.status(500).render('error', {
        title: 'Server Error',
        message: 'An error occurred while loading the bio page.',
        code: 500
      });
    }
  }

  /**
   * Bio settings page (authenticated)
   * GET /bio/settings
   */
  static getBioSettings(req, res) {
    try {
      // Get or create bio page
      let bioPage = BioPage.findByUserId(req.session.userId);

      // Auto-create if doesn't exist
      if (!bioPage) {
        bioPage = BioPage.create(
          req.session.userId,
          req.user.username,  // Default display name to username
          null,
          'dark'
        );
      }

      // Get user's URLs
      const userUrls = Url.findByCreatorId(req.session.userId, null, 0);

      // Get URLs currently on bio page
      const bioPageUrls = BioPage.getUrls(bioPage.id);
      const bioPageUrlIds = new Set(bioPageUrls.map(u => u.id));

      res.render('bio-settings', {
        user: req.user,
        bioPage,
        userUrls,
        bioPageUrlIds,
        socialLinks: bioPage.socialLinks || [],
        currentPage: 'bio-settings'
      });

    } catch (error) {
      console.error('Bio settings error:', error);
      res.status(500).render('error', {
        title: 'Server Error',
        message: 'An error occurred while loading bio settings.',
        code: 500
      });
    }
  }

  /**
   * Update bio page
   * PUT /api/bio
   */
  static async updateBioPage(req, res) {
    try {
      const { displayName, bio, theme, socialLinks, gradientStart, gradientEnd } = req.body;

      // Validation
      if (!displayName || displayName.trim().length === 0) {
        return res.status(400).json({ error: 'Display name is required' });
      }

      if (displayName.length > 100) {
        return res.status(400).json({ error: 'Display name must be 100 characters or less' });
      }

      if (bio && bio.length > 500) {
        return res.status(400).json({ error: 'Bio must be 500 characters or less' });
      }

      if (theme && !['dark', 'light', 'gradient'].includes(theme)) {
        return res.status(400).json({ error: 'Invalid theme' });
      }

      // Validate gradient colors if provided
      const hexColorRegex = /^#[0-9A-F]{6}$/i;
      if (gradientStart && !hexColorRegex.test(gradientStart)) {
        return res.status(400).json({ error: 'Invalid gradient start color' });
      }
      if (gradientEnd && !hexColorRegex.test(gradientEnd)) {
        return res.status(400).json({ error: 'Invalid gradient end color' });
      }

      // Validate social links
      let parsedSocialLinks = [];
      if (socialLinks) {
        try {
          parsedSocialLinks = typeof socialLinks === 'string'
            ? JSON.parse(socialLinks)
            : socialLinks;

          if (!Array.isArray(parsedSocialLinks)) {
            throw new Error('Social links must be an array');
          }

          // Validate and normalize each link
          for (const link of parsedSocialLinks) {
            if (!link.url) {
              throw new Error('Each social link must have a URL');
            }

            // Add https:// if no protocol is specified
            if (!link.url.match(/^https?:\/\//i)) {
              link.url = 'https://' + link.url;
            }

            // Basic URL validation
            new URL(link.url);
          }
        } catch (e) {
          console.error('Social links validation error:', e);
          return res.status(400).json({ error: e.message || 'Invalid social links format' });
        }
      }

      // Get or create bio page
      let bioPage = BioPage.findByUserId(req.session.userId);

      if (!bioPage) {
        bioPage = BioPage.create(
          req.session.userId,
          displayName,
          bio,
          theme,
          gradientStart || '#667eea',
          gradientEnd || '#764ba2'
        );
      } else {
        bioPage = BioPage.update(bioPage.id, {
          displayName,
          bio,
          theme,
          socialLinks: parsedSocialLinks,
          gradientStart,
          gradientEnd
        });
      }

      res.json({ success: true, bioPage });

    } catch (error) {
      console.error('Update bio page error:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Toggle URL on bio page
   * POST /api/bio/urls/:urlId/toggle
   */
  static toggleUrlOnBioPage(req, res) {
    try {
      const urlId = parseInt(req.params.urlId);

      // Verify URL ownership
      const url = Url.findById(urlId);
      if (!url) {
        return res.status(404).json({ error: 'URL not found' });
      }

      if (url.creatorId !== req.session.userId) {
        return res.status(403).json({ error: 'Not authorized' });
      }

      // Get or create bio page
      let bioPage = BioPage.findByUserId(req.session.userId);
      if (!bioPage) {
        bioPage = BioPage.create(
          req.session.userId,
          req.user.username,
          null,
          'dark'
        );
      }

      // Toggle
      const isOnBioPage = BioPage.hasUrl(bioPage.id, urlId);

      if (isOnBioPage) {
        BioPage.detachUrl(bioPage.id, urlId);
      } else {
        BioPage.attachUrl(bioPage.id, urlId);
      }

      res.json({
        success: true,
        isOnBioPage: !isOnBioPage
      });

    } catch (error) {
      console.error('Toggle URL error:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Reorder URLs on bio page
   * PUT /api/bio/urls/reorder
   */
  static reorderBioPageUrls(req, res) {
    try {
      const { urlPositions } = req.body;  // Array of { urlId, position }

      if (!Array.isArray(urlPositions)) {
        return res.status(400).json({ error: 'Invalid request format' });
      }

      // Get bio page
      const bioPage = BioPage.findByUserId(req.session.userId);
      if (!bioPage) {
        return res.status(404).json({ error: 'Bio page not found' });
      }

      // Verify all URLs belong to user
      for (const { urlId } of urlPositions) {
        const url = Url.findById(urlId);
        if (!url || url.creatorId !== req.session.userId) {
          return res.status(403).json({ error: 'Not authorized' });
        }
      }

      // Update positions
      BioPage.updateUrlPositions(bioPage.id, urlPositions);

      res.json({ success: true });

    } catch (error) {
      console.error('Reorder URLs error:', error);
      res.status(500).json({ error: error.message });
    }
  }
}

module.exports = BioPageController;
