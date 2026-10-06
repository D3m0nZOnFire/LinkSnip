const Url = require('../models/Url');
const Report = require('../models/Report');
const { recordStatus, isLive, message: accessMessage } = require('../services/accessService');
const { itemShare } = require('../services/sharePreview');

class InfoController {
  /**
   * Show URL preview/info page
   * GET /info/:slug
   */
  static getUrlInfo(req, res) {
    const { slug } = req.params;

    try {
      const url = Url.findBySlug(slug);

      if (!url) {
        return res.status(404).render('error', {
          title: 'URL Not Found',
          message: 'The short URL you are looking for does not exist.',
          code: 404
        });
      }

      // Status from the link itself (the password is shown separately on the page)
      const status = recordStatus('url', url);
      const validation = { status, live: isLive(status), message: accessMessage('url', status) };

      // Block access to info page for links that aren't active yet
      if (status === 'scheduled') {
        return res.status(404).render('error', {
          title: 'Link Not Yet Active',
          message: validation.message,
          code: 404
        });
      }

      // Get report count for this URL (only pending reports)
      const reportCount = Report.countPending('url', url.id);

      // Calculate link age
      const createdDate = new Date(url.createdAt);
      const now = new Date();
      const ageInDays = Math.floor((now - createdDate) / (1000 * 60 * 60 * 24));

      // "Continue to <domain>": the host name of the destination (null if it isn't a valid address)
      let destinationHost = null;
      try { destinationHost = new URL(url.longUrl).hostname || null; } catch (_) { destinationHost = null; }

      res.render('url-info', {
        url,
        destinationHost,
        reportCount,
        ageInDays,
        validation,
        baseUrl: `${req.protocol}://${req.get('host')}`,
        user: req.user || null,
        share: itemShare('url', url, {
          baseUrl: `${req.protocol}://${req.get('host')}`,
          path: `/info/${url.slug}`,
          facts: [destinationHost ? `Short link to ${destinationHost}` : 'Short link']
        })
      });

    } catch (error) {
      console.error('URL info error:', error);
      res.status(500).render('error', {
        title: 'Server Error',
        message: 'An error occurred while loading the URL information.',
        code: 500
      });
    }
  }
}

module.exports = InfoController;
