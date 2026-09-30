const Url = require('../models/Url');
const Report = require('../models/Report');
const { recordStatus, isLive, message: accessMessage } = require('../services/accessService');

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

      res.render('url-info', {
        url,
        reportCount,
        ageInDays,
        validation,
        baseUrl: `${req.protocol}://${req.get('host')}`,
        user: req.user || null
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
