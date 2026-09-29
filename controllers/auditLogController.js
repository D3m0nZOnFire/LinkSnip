const AuditLog = require('../models/AuditLog');
const { logSecurity, ACTIONS } = require('../services/auditService');

class AuditLogController {
  /**
   * Render audit logs page
   * GET /admin/audit-logs
   */
  static getAuditLogsPage(req, res) {
    try {
      // Get filters from query params
      const category = req.query.category || null;
      const action = req.query.action || null;
      const userId = req.query.userId || null;
      const search = req.query.search || null;
      const limit = req.query.limit ? (req.query.limit === 'all' ? null : parseInt(req.query.limit)) : 50;
      const page = parseInt(req.query.page) || 1;
      const offset = limit !== null ? (page - 1) * limit : 0;

      // Get logs with filters
      const options = {
        category,
        action,
        userId,
        search,
        limit,
        offset
      };

      const logs = AuditLog.findAll(options);
      const totalLogs = AuditLog.count(options);
      const stats = AuditLog.getStats();

      // Get unique categories and actions for filters
      const categories = AuditLog.getCategories();
      const actions = AuditLog.getActions();

      // Calculate pagination
      const totalPages = limit !== null ? Math.ceil(totalLogs / limit) : 1;

      res.render('admin-audit-logs', {
        user: req.user,
        logs,
        stats,
        categories,
        actions,
        filters: {
          category,
          action,
          userId,
          search
        },
        pagination: {
          currentPage: page,
          totalPages,
          limit: limit !== null ? limit : 'all',
          totalLogs,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      });
    } catch (error) {
      console.error('Get audit logs page error:', error);
      res.status(500).render('error', {
        title: 'Server Error',
        message: 'Failed to load audit logs',
        code: 500
      });
    }
  }

  /**
   * Export audit logs
   * GET /api/admin/audit-logs/export
   */
  static exportAuditLogs(req, res) {
    try {
      const format = req.query.format || 'csv';
      const category = req.query.category || null;
      const action = req.query.action || null;
      const userId = req.query.userId || null;
      const search = req.query.search || null;

      // Get all logs matching filters (no limit)
      const options = {
        category,
        action,
        userId,
        search,
        limit: null,
        offset: 0
      };

      const logs = AuditLog.findAll(options);

      if (!logs || logs.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'No audit logs to export'
        });
      }

      let content, filename, contentType;

      if (format === 'json') {
        // JSON export
        content = JSON.stringify(logs, null, 2);
        filename = `audit-logs-export-${Date.now()}.json`;
        contentType = 'application/json';
      } else {
        // CSV export (default)
        const csvHeaders = [
          'ID',
          'Timestamp',
          'User ID',
          'Username',
          'Action',
          'Category',
          'Target Type',
          'Target ID',
          'Target Description',
          'IP Address',
          'User Agent',
          'Details'
        ];

        const csvRows = logs.map(log => [
          log.id,
          log.createdAt,
          log.userId || '',
          log.username || '',
          log.action,
          log.category,
          log.targetType || '',
          log.targetId || '',
          log.targetDescription || '',
          log.ipAddress || '',
          log.userAgent || '',
          log.details || ''
        ]);

        // Escape CSV fields (quote fields containing commas, quotes, or newlines)
        const escapeCSV = (field) => {
          if (field === null || field === undefined) return '';
          const str = String(field);
          if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        };

        const csvLines = [
          csvHeaders.join(','),
          ...csvRows.map(row => row.map(escapeCSV).join(','))
        ];

        content = csvLines.join('\n');
        filename = `audit-logs-export-${Date.now()}.csv`;
        contentType = 'text/csv';
      }

      // Log export action
      logSecurity(ACTIONS.EXPORT_AUDIT_LOGS, req, 'audit_logs', null, `Exported ${logs.length} audit logs as ${format.toUpperCase()}`, {
        logCount: logs.length,
        format: format,
        fileName: filename,
        filters: { category, action, userId, search }
      });

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(content);
    } catch (error) {
      console.error('Export audit logs error:', error);
      return res.status(500).json({
        success: false,
        error: 'Export failed',
        details: error.message
      });
    }
  }
}

module.exports = AuditLogController;
