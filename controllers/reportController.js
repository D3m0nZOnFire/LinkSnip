const Url = require('../models/Url');
const Report = require('../models/Report');
const Bundle = require('../models/Bundle');
const BundleReport = require('../models/BundleReport');
const { logAdminAction, logSecurity, ACTIONS } = require('../services/auditService');
const moderation = require('../services/moderationService');

class ReportController {
  /**
   * Submit a URL report
   * POST /api/report
   */
  static submitReport(req, res) {
    const { urlId, reason, description } = req.body;

    try {
      // Validate input
      if (!urlId || !reason) {
        return res.status(400).json({ error: 'URL ID and reason are required' });
      }

      // Check if URL exists
      const url = Url.findById(urlId);
      if (!url) {
        return res.status(404).json({ error: 'URL not found' });
      }

      // Get reporter IP
      const reporterIp = req.ip || req.connection.remoteAddress || 'unknown';

      // Check if this IP has already reported this URL
      if (Report.hasReported(urlId, reporterIp)) {
        return res.status(400).json({ error: 'You have already reported this URL' });
      }

      // Validate reason
      const validReasons = Object.keys(Report.REASONS);
      if (!validReasons.includes(reason)) {
        return res.status(400).json({ error: 'Invalid report reason' });
      }

      // Create report
      const report = Report.create({
        urlId,
        reporterIp,
        reason,
        description
      });

      // Quarantine at moderation.reportThreshold distinct reporters (see moderationService)
      const reportCount = Report.countByUrlId(urlId);
      const quarantined = moderation.afterReport('url', url.id, req);

      res.json({
        success: true,
        message: 'Report submitted successfully. Thank you for helping keep the community safe.',
        quarantined,
        reportCount,
        report: {
          id: report.id,
          reason: report.reason,
          createdAt: report.createdAt
        }
      });

    } catch (error) {
      console.error('Submit report error:', error);
      res.status(500).json({ error: 'Failed to submit report' });
    }
  }

  /**
   * Admin decision on a quarantined (or reported) link or bundle
   * POST /api/admin/moderation/:type/:id/block and /clear
   */
  static moderate(action) {
    return (req, res) => {
      try {
        moderation[action](req.params.type, parseInt(req.params.id), req);
        res.json({ success: true });
      } catch (error) {
        if (!(error instanceof moderation.ModerationError)) throw error;
        res.status(error.status).json({ success: false, error: error.message });
      }
    };
  }

  /**
   * Get admin reports page
   * GET /admin/reports
   */
  static getReportsPage(req, res) {
    try {
      // Get filter from query params - default to 'pending' for cleaner UX
      // Use 'all' explicitly to show all reports including dismissed
      const statusParam = req.query.status;
      const status = statusParam === 'all' ? null : (statusParam || 'pending');
      const limit = req.query.limit ? (req.query.limit === 'all' ? null : parseInt(req.query.limit)) : 50;
      const page = parseInt(req.query.page) || 1;
      const offset = limit !== null ? (page - 1) * limit : 0;
      const type = req.query.type === 'bundle' ? 'bundle' : 'url';

      // Get reports and stats (URL or bundle depending on type)
      const reports = type === 'bundle' ? BundleReport.findAll(status, limit, offset) : Report.findAll(status, limit, offset);
      const totalReports = type === 'bundle' ? BundleReport.count(status) : Report.count(status);
      const stats = type === 'bundle' ? BundleReport.getStats() : Report.getStats();
      // Always fetch both stats for the type tab badges
      const urlStats = type === 'url' ? stats : Report.getStats();
      const bundleStats = type === 'bundle' ? stats : BundleReport.getStats();

      // Calculate pagination
      const totalPages = limit !== null ? Math.ceil(totalReports / limit) : 1;

      res.render('admin-reports', {
        user: req.user,
        quarantined: moderation.listQuarantined(),
        reports,
        stats,
        urlStats,
        bundleStats,
        type,
        reasons: Report.REASONS,
        statuses: Report.STATUSES,
        currentStatus: status,
        pagination: {
          currentPage: page,
          totalPages,
          limit: limit !== null ? limit : 'all',
          totalReports,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      });

    } catch (error) {
      console.error('Get reports page error:', error);
      res.status(500).render('error', {
        title: 'Server Error',
        message: 'Failed to load reports',
        code: 500
      });
    }
  }

  /**
   * Update report status
   * PUT /api/admin/reports/:id
   */
  static updateReportStatus(req, res) {
    const { id } = req.params;
    const { status, action } = req.body;

    try {
      const report = Report.findById(id);
      if (!report) {
        return res.status(404).json({ error: 'Report not found' });
      }

      // Handle block/unblock actions
      if (action === 'block') {
        const url = Url.findById(report.urlId);
        Url.block(report.urlId);
        Report.updateStatus(id, Report.STATUSES.BLOCKED, req.session.userId);

        // Log block action
        logAdminAction(ACTIONS.BLOCK_URL, req, 'url', report.urlId, url ? `/s/${url.slug} → ${url.longUrl}` : `URL #${report.urlId}`, {
          reportId: report.id,
          reason: report.reason,
          slug: url ? url.slug : null
        });

        return res.json({ success: true, message: 'URL blocked successfully' });
      }

      if (action === 'unblock') {
        const url = Url.findById(report.urlId);
        Url.unblock(report.urlId);
        Report.updateStatus(id, Report.STATUSES.REVIEWED, req.session.userId);

        // Log unblock action
        logAdminAction(ACTIONS.UNBLOCK_URL, req, 'url', report.urlId, url ? `/s/${url.slug} → ${url.longUrl}` : `URL #${report.urlId}`, {
          reportId: report.id,
          reason: report.reason,
          slug: url ? url.slug : null
        });

        return res.json({ success: true, message: 'URL unblocked successfully' });
      }

      // Validate status
      const validStatuses = Object.values(Report.STATUSES);
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }

      // Update report status
      Report.updateStatus(id, status, req.session.userId);

      // Log report review action
      const url = Url.findById(report.urlId);
      const auditAction = status === Report.STATUSES.DISMISSED ? ACTIONS.DISMISS_REPORT : ACTIONS.REVIEW_REPORT;
      logSecurity(auditAction, req, 'report', report.id, url ? `/s/${url.slug}` : `URL #${report.urlId}`, {
        previousStatus: report.status,
        newStatus: status,
        reason: report.reason,
        urlId: report.urlId
      });

      res.json({ success: true, message: 'Report status updated' });

    } catch (error) {
      console.error('Update report status error:', error);
      res.status(500).json({ error: 'Failed to update report status' });
    }
  }

  /**
   * Delete a report
   * DELETE /api/admin/reports/:id
   */
  static deleteReport(req, res) {
    const { id } = req.params;

    try {
      const report = Report.findById(id);
      if (!report) {
        return res.status(404).json({ error: 'Report not found' });
      }

      // Log report deletion for audit trail
      const url = Url.findById(report.urlId);
      logSecurity(ACTIONS.DISMISS_REPORT, req, 'report', report.id, url ? `/s/${url.slug}` : `URL #${report.urlId}`, {
        action: 'DELETE',
        reason: report.reason,
        urlId: report.urlId,
        status: report.status
      });

      Report.delete(id);
      res.json({ success: true, message: 'Report deleted' });

    } catch (error) {
      console.error('Delete report error:', error);
      res.status(500).json({ error: 'Failed to delete report' });
    }
  }

  /**
   * Ban user who created the reported URL
   * POST /api/admin/reports/:id/ban-user
   */
  static banUserFromReport(req, res) {
    const { id } = req.params;
    const { userId } = req.body;

    try {
      const report = Report.findById(id);
      if (!report) {
        return res.status(404).json({ error: 'Report not found' });
      }

      const url = Url.findById(report.urlId);
      if (!url) {
        return res.status(404).json({ error: 'URL not found' });
      }

      // Verify the userId matches the URL creator
      if (url.creatorId !== userId) {
        return res.status(400).json({ error: 'User ID does not match URL creator' });
      }

      // Get user info for logging
      const User = require('../models/User');
      const user = User.findById(userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Ban the user
      const db = require('../config/database');
      db.prepare('UPDATE users SET isBanned = 1 WHERE id = ?').run(userId);

      // Block all URLs created by this user
      const blockedCount = db.prepare('UPDATE urls SET isBlocked = 1 WHERE creatorId = ?').run(userId).changes;

      // Mark report as reviewed
      Report.updateStatus(id, Report.STATUSES.BLOCKED, req.session.userId);

      // Log the ban action
      logAdminAction(ACTIONS.BAN_USER, req, 'user', userId, user.username, {
        source: 'report_review',
        reportId: report.id,
        urlId: report.urlId,
        reason: report.reason,
        urlsBlocked: blockedCount
      });

      // Log the URL block action
      logAdminAction(ACTIONS.BLOCK_URL, req, 'url', report.urlId, url ? `/s/${url.slug} → ${url.longUrl}` : `URL #${report.urlId}`, {
        reportId: report.id,
        userBanned: true,
        username: user.username
      });

      res.json({
        success: true,
        message: `User "${user.username}" has been banned. ${blockedCount} URL(s) blocked.`,
        urlsBlocked: blockedCount
      });

    } catch (error) {
      console.error('Ban user from report error:', error);
      res.status(500).json({ error: 'Failed to ban user' });
    }
  }
  /**
   * Submit a bundle report
   * POST /api/bundle-report
   */
  static submitBundleReport(req, res) {
    const { bundleId, reason, description } = req.body;

    try {
      if (!bundleId || !reason) {
        return res.status(400).json({ error: 'Bundle ID and reason are required' });
      }

      const bundle = Bundle.findById(bundleId);
      if (!bundle) {
        return res.status(404).json({ error: 'Bundle not found' });
      }

      const reporterIp = req.ip || req.connection.remoteAddress || 'unknown';

      if (BundleReport.hasReported(bundleId, reporterIp)) {
        return res.status(400).json({ error: 'You have already reported this bundle' });
      }

      const validReasons = Object.keys(BundleReport.REASONS);
      if (!validReasons.includes(reason)) {
        return res.status(400).json({ error: 'Invalid report reason' });
      }

      const report = BundleReport.create({ bundleId, reporterIp, reason, description });

      // Quarantine at moderation.reportThreshold distinct reporters (see moderationService)
      const reportCount = BundleReport.countByBundleId(bundleId);
      const quarantined = moderation.afterReport('bundle', bundle.id, req);

      res.json({
        success: true,
        message: 'Report submitted successfully. Thank you for helping keep the community safe.',
        quarantined,
        reportCount,
        report: { id: report.id, reason: report.reason, createdAt: report.createdAt }
      });

    } catch (error) {
      console.error('Submit bundle report error:', error);
      res.status(500).json({ error: 'Failed to submit report' });
    }
  }

  /**
   * Update bundle report status
   * PUT /api/admin/bundle-reports/:id
   */
  static updateBundleReportStatus(req, res) {
    const { id } = req.params;
    const { status, action } = req.body;

    try {
      const report = BundleReport.findById(id);
      if (!report) {
        return res.status(404).json({ error: 'Report not found' });
      }

      const bundle = Bundle.findById(report.bundleId);

      if (action === 'block') {
        Bundle.block(report.bundleId);
        BundleReport.updateStatus(id, BundleReport.STATUSES.BLOCKED, req.session.userId);
        logAdminAction(ACTIONS.BLOCK_BUNDLE, req, 'bundle', report.bundleId,
          bundle ? `/b/${bundle.slug} - "${bundle.title}"` : `Bundle #${report.bundleId}`,
          { reportId: report.id, reason: report.reason }
        );
        return res.json({ success: true, message: 'Bundle blocked successfully' });
      }

      if (action === 'unblock') {
        Bundle.unblock(report.bundleId);
        BundleReport.updateStatus(id, BundleReport.STATUSES.REVIEWED, req.session.userId);
        logAdminAction(ACTIONS.UNBLOCK_BUNDLE, req, 'bundle', report.bundleId,
          bundle ? `/b/${bundle.slug} - "${bundle.title}"` : `Bundle #${report.bundleId}`,
          { reportId: report.id, reason: report.reason }
        );
        return res.json({ success: true, message: 'Bundle unblocked successfully' });
      }

      const validStatuses = Object.values(BundleReport.STATUSES);
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }

      BundleReport.updateStatus(id, status, req.session.userId);

      const auditAction = status === BundleReport.STATUSES.DISMISSED ? ACTIONS.DISMISS_BUNDLE_REPORT : ACTIONS.REVIEW_BUNDLE_REPORT;
      logSecurity(auditAction, req, 'bundle_report', report.id,
        bundle ? `/b/${bundle.slug}` : `Bundle #${report.bundleId}`,
        { previousStatus: report.status, newStatus: status, reason: report.reason, bundleId: report.bundleId }
      );

      res.json({ success: true, message: 'Report status updated' });

    } catch (error) {
      console.error('Update bundle report status error:', error);
      res.status(500).json({ error: 'Failed to update report status' });
    }
  }

  /**
   * Delete a bundle report
   * DELETE /api/admin/bundle-reports/:id
   */
  static deleteBundleReport(req, res) {
    const { id } = req.params;

    try {
      const report = BundleReport.findById(id);
      if (!report) {
        return res.status(404).json({ error: 'Report not found' });
      }

      const bundle = Bundle.findById(report.bundleId);
      logSecurity(ACTIONS.DISMISS_BUNDLE_REPORT, req, 'bundle_report', report.id,
        bundle ? `/b/${bundle.slug}` : `Bundle #${report.bundleId}`,
        { action: 'DELETE', reason: report.reason, bundleId: report.bundleId, status: report.status }
      );

      BundleReport.delete(id);
      res.json({ success: true, message: 'Report deleted' });

    } catch (error) {
      console.error('Delete bundle report error:', error);
      res.status(500).json({ error: 'Failed to delete report' });
    }
  }
}

module.exports = ReportController;
