const Analytics = require('../models/Analytics');
const Url = require('../models/Url');

/**
 * Everything the analytics page shows for one URL. Used by the owner's page
 * and by public share links (/stats/:token).
 */
function buildSummary(url) {
  const summary = Analytics.getSummary(url.id);
  return {
    url,
    totalClicks: summary.totalClicks,
    clicksByDate: summary.clicksByDate,
    clicksByDatePeriod: summary.clicksByDatePeriod,
    referrers: summary.referrers,
    browsers: summary.browsers,
    os: summary.os,
    devices: summary.devices,
    countries: summary.countries,
    referrersCount: summary.referrers.length,
    devicesCount: summary.devices.length,
    countriesCount: summary.countries.length
  };
}

// Analytics are private to the URL's owner and admins; others use share links.
const canView = (user, url) => user && (user.isAdmin || url.creatorId === user.id);

class AnalyticsController {
  /**
   * Render analytics page for a specific URL
   * GET /analytics/:id
   */
  static getAnalyticsPage(req, res) {
    const urlId = parseInt(req.params.id);

    try {
      const url = Url.findById(urlId);

      if (!url) {
        return res.status(404).render('error', {
          title: 'Not Found',
          message: 'This URL does not exist.',
          code: 404
        });
      }

      if (!canView(req.user, url)) {
        return res.redirect('/dashboard');
      }

      res.render('analytics', {
        user: req.user,
        url,
        summary: buildSummary(url),
        baseUrl: `${req.protocol}://${req.get('host')}`,
        readOnly: false
      });
    } catch (error) {
      console.error('Analytics page error:', error);
      res.status(500).render('error', {
        title: 'Server Error',
        message: 'Failed to load analytics data.',
        code: 500
      });
    }
  }

  /**
   * Get analytics data as JSON
   * GET /api/analytics/:id
   */
  static getAnalyticsData(req, res) {
    const { id } = req.params;
    const { days = 30 } = req.query;

    try {
      const url = Url.findById(id);

      if (!url) {
        return res.status(404).json({ error: 'URL not found' });
      }

      if (!canView(req.user, url)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const summary = Analytics.getSummary(id);
      res.json({
        url,
        totalClicks: summary.totalClicks,
        clicksByDate: Analytics.getClicksByDate(id, parseInt(days)),
        referrers: summary.referrers,
        browsers: summary.browsers,
        os: summary.os,
        devices: summary.devices,
        countries: summary.countries
      });
    } catch (error) {
      console.error('Analytics data error:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Get top URLs (admin only)
   * GET /api/analytics/top
   */
  static getTopUrls(req, res) {
    const { limit = 10, days = null } = req.query;

    try {
      const topUrls = Analytics.getTopUrls(parseInt(limit), days ? parseInt(days) : null);
      res.json(topUrls);
    } catch (error) {
      console.error('Top URLs error:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Render admin analytics overview page
   * GET /admin/analytics
   */
  static getAdminAnalyticsPage(req, res) {
    try {
      const topUrls = Analytics.getTopUrls(20, 30);

      // Get total analytics count
      const db = require('../config/database');
      const totalClicksStmt = db.prepare('SELECT COUNT(*) as count FROM analytics');
      const totalClicks = totalClicksStmt.get().count;

      const totalUrlsStmt = db.prepare('SELECT COUNT(*) as count FROM urls');
      const totalUrls = totalUrlsStmt.get().count;

      res.render('admin-analytics', {
        user: req.user,
        topUrls,
        totalClicks,
        totalUrls,
        baseUrl: `${req.protocol}://${req.get('host')}`
      });
    } catch (error) {
      console.error('Admin analytics page error:', error);
      res.status(500).render('error', {
        title: 'Server Error',
        message: 'Failed to load analytics data.',
        code: 500
      });
    }
  }
}

module.exports = AnalyticsController;
module.exports.buildSummary = buildSummary;
