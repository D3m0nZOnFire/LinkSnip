const Report = require('../models/Report');
const configService = require('../services/configService');
const moderation = require('../services/moderationService');
const { recordStatus, isLive } = require('../services/accessService');
const { CONTENT_TYPES, contentType } = require('../services/contentTypes');
const { logSecurity, ACTIONS } = require('../services/auditService');

const db = require('../config/database');

/** The item a report is about, or null when the type's feature is switched off or it doesn't exist. */
function findTarget(type, id) {
  const info = contentType(type);
  if (info.feature && !configService.get(`features.${info.feature}`)) return null;
  return db.prepare(`SELECT * FROM ${info.table} WHERE id = ?`).get(id) || null;
}

/** Turn a moderation error into its JSON response; rethrow anything else. */
function sendModerationError(res, error) {
  if (!(error instanceof moderation.ModerationError)) throw error;
  return res.status(error.status).json({ success: false, error: error.message });
}

class ReportController {
  /**
   * Report any content type
   * POST /api/reports  { type, id, reason, description }
   */
  static submit(req, res) {
    const { type, id, reason, description } = req.body;

    if (!CONTENT_TYPES[type] || !id || !reason) {
      return res.status(400).json({ error: 'Type, ID and reason are required' });
    }
    if (!Object.keys(Report.REASONS).includes(reason)) {
      return res.status(400).json({ error: 'Invalid report reason' });
    }

    const item = findTarget(type, id);
    if (!item) return res.status(404).json({ error: 'Not found' });

    // Blocked, scheduled, expired or used up: there is nothing live to report
    if (!isLive(recordStatus(type, item))) {
      return res.status(410).json({ error: 'This item is no longer available' });
    }

    const reporterIp = req.ip || (req.connection && req.connection.remoteAddress) || 'unknown';
    if (Report.hasReported(type, item.id, reporterIp)) {
      return res.status(400).json({ error: 'You have already reported this' });
    }

    const report = Report.create({ targetType: type, targetId: item.id, reporterIp, reason, description });
    const quarantined = moderation.afterReport(type, item.id, req);

    res.json({
      success: true,
      message: 'Report submitted successfully. Thank you for helping keep the community safe.',
      quarantined,
      reportCount: Report.countPending(type, item.id),
      report: { id: report.id, reason: report.reason, createdAt: report.createdAt }
    });
  }

  /**
   * Admin decision on a quarantined (or reported) item
   * POST /api/admin/moderation/:type/:id/block and /clear
   */
  static moderate(action) {
    return (req, res) => {
      try {
        moderation[action](req.params.type, parseInt(req.params.id), req);
        res.json({ success: true });
      } catch (error) {
        sendModerationError(res, error);
      }
    };
  }

  /**
   * Admin → Reports: every type, filterable by type and status
   * GET /admin/reports?type=all|url|bundle|paste|file&status=pending|reviewed|blocked|dismissed|all
   */
  static getReportsPage(req, res) {
    // Default to pending reports; 'all' shows every status
    const statusParam = req.query.status;
    const status = statusParam === 'all' ? null : (statusParam || 'pending');
    const type = CONTENT_TYPES[req.query.type] ? req.query.type : 'all';
    const limit = req.query.limit ? (req.query.limit === 'all' ? null : parseInt(req.query.limit)) : 50;
    const page = parseInt(req.query.page) || 1;
    const offset = limit !== null ? (page - 1) * limit : 0;

    const filter = { type: type === 'all' ? null : type, status };
    const reports = Report.findAll({ ...filter, limit, offset });
    const totalReports = Report.count(filter);
    const typeStats = Report.statsByType();
    const totalPages = limit !== null ? Math.ceil(totalReports / limit) : 1;

    res.render('admin-reports', {
      user: req.user,
      quarantined: moderation.listQuarantined(),
      reports,
      typeStats,
      stats: typeStats[type],
      type,
      types: Report.TYPES,
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
  }

  /**
   * Block / unblock the reported item, or change the report's status
   * PUT /api/admin/reports/:id  { action: 'block' | 'unblock' } or { status }
   */
  static updateReport(req, res) {
    const report = Report.findById(req.params.id);
    if (!report) return res.status(404).json({ error: 'Report not found' });

    const { status, action } = req.body;
    try {
      if (action === 'block' || action === 'unblock') {
        moderation.setBlockedFromReport(report, action === 'block', req);
        return res.json({ success: true, message: action === 'block' ? 'Blocked' : 'Unblocked' });
      }
    } catch (error) {
      return sendModerationError(res, error);
    }

    if (!Object.values(Report.STATUSES).includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    Report.updateStatus(report.id, status, req.user ? req.user.id : null);
    logSecurity(status === Report.STATUSES.DISMISSED ? ACTIONS.DISMISS_REPORT : ACTIONS.REVIEW_REPORT,
      req, 'report', report.id, `${report.targetType} #${report.targetId}`, {
        previousStatus: report.status,
        newStatus: status,
        reason: report.reason,
        targetType: report.targetType,
        targetId: report.targetId
      });
    res.json({ success: true, message: 'Report status updated' });
  }

  /**
   * DELETE /api/admin/reports/:id
   */
  static deleteReport(req, res) {
    const report = Report.findById(req.params.id);
    if (!report) return res.status(404).json({ error: 'Report not found' });

    logSecurity(ACTIONS.DISMISS_REPORT, req, 'report', report.id, `${report.targetType} #${report.targetId}`, {
      action: 'DELETE',
      reason: report.reason,
      targetType: report.targetType,
      targetId: report.targetId,
      status: report.status
    });
    Report.delete(report.id);
    res.json({ success: true, message: 'Report deleted' });
  }

  /**
   * Ban the owner of the reported item and block everything they own
   * POST /api/admin/reports/:id/ban-user  { userId }
   */
  static banOwner(req, res) {
    const report = Report.findById(req.params.id);
    if (!report) return res.status(404).json({ error: 'Report not found' });

    try {
      const { username, blocked } = moderation.banOwnerFromReport(report, req.body.userId, req);
      const total = Object.values(blocked).reduce((sum, n) => sum + n, 0);
      res.json({ success: true, message: `User "${username}" has been banned. ${total} item(s) blocked.`, blocked });
    } catch (error) {
      sendModerationError(res, error);
    }
  }
}

module.exports = ReportController;
