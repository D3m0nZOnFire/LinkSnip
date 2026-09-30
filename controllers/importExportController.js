const ImportExportService = require('../services/importExportService');
const Url = require('../models/Url');
const Tag = require('../models/Tag');
const SlugGenerator = require('../services/slugGenerator');
const { logSecurity, ACTIONS } = require('../services/auditService');
const RoleService = require('../services/roleService');

class ImportExportController {
  /**
   * GET /import - Show import page
   */
  static getImportPage(req, res) {
    res.render('import', {
      user: req.user,
      currentPage: 'import',
      error: null,
      success: null
    });
  }

  /**
   * POST /api/import - Handle bulk URL import
   */
  static async importUrls(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'No file uploaded'
        });
      }

      const fileContent = req.file.buffer.toString('utf8');
      const fileExt = req.file.originalname.split('.').pop().toLowerCase();

      // Parse the file
      const parseResult = ImportExportService.parseImportFile(fileContent, fileExt);

      if (!parseResult.success) {
        return res.status(400).json({
          success: false,
          error: 'Failed to parse file',
          details: parseResult.errors
        });
      }

      // Validate the data (batch size from the user's role; null means unlimited)
      const maxUrls = RoleService.limit(req.user, 'importBatchSize');
      const validation = ImportExportService.validateImportData(parseResult.data, maxUrls === null ? Infinity : maxUrls);

      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: validation.errors
        });
      }

      // Process the import
      const results = {
        total: parseResult.data.length,
        success: 0,
        failed: 0,
        errors: [],
        urls: []
      };

      for (let i = 0; i < parseResult.data.length; i++) {
        const item = parseResult.data[i];
        const lineNum = i + 1;

        try {
          // Generate or validate slug
          const { slug } = SlugGenerator.getValidSlug(item.slug || null);

          // Calculate expiration date
          let expiresAt = null;
          if (item.expirationDays) {
            const expirationDate = new Date();
            expirationDate.setDate(expirationDate.getDate() + item.expirationDays);
            expiresAt = expirationDate.toISOString();
          }

          // Create URL
          const url = Url.create({
            slug,
            longUrl: item.longUrl,
            creatorId: req.user.id,
            maxUses: item.maxUses || null,
            expiresAt
          });

          // Attach tags if provided
          if (item.tags) {
            // Tags in CSV are separated by semicolons to avoid conflict with CSV commas
            // Replace semicolons with commas for Tag.parseTagString which expects comma-separated
            const tagsWithCommas = item.tags.replace(/;/g, ',');
            const tagArray = Tag.parseTagString(tagsWithCommas);
            Tag.setForItem('url', url.id, tagArray);
          }

          results.success++;
          results.urls.push({
            line: lineNum,
            slug,
            longUrl: item.longUrl,
            shortUrl: `${req.protocol}://${req.get('host')}/s/${slug}`
          });
        } catch (error) {
          results.failed++;
          results.errors.push({
            line: lineNum,
            url: item.longUrl,
            error: error.message
          });
        }
      }

      // Log import operation
      logSecurity(ACTIONS.IMPORT_URLS, req, 'import', null, `Imported ${results.success}/${results.total} URLs`, {
        totalUrls: results.total,
        successCount: results.success,
        failedCount: results.failed,
        fileFormat: fileExt,
        fileName: req.file.originalname
      });

      return res.json({
        success: true,
        message: `Import complete: ${results.success} URLs created, ${results.failed} failed`,
        results
      });
    } catch (error) {
      console.error('Import error:', error);
      return res.status(500).json({
        success: false,
        error: 'Import failed',
        details: error.message
      });
    }
  }

  /**
   * GET /api/export - Export user's URLs
   */
  static exportUrls(req, res) {
    try {
      const format = req.query.format || 'csv';
      const isAdmin = req.user && req.user.isAdmin;

      // Get URLs (all for admin, user's own for regular users)
      let urls;
      if (isAdmin) {
        urls = Url.findAll(null, 0); // All URLs
      } else {
        urls = Url.findByCreatorId(req.user.id, null, 0); // User's URLs
      }

      if (!urls || urls.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'No URLs to export'
        });
      }

      let content, filename, contentType;

      if (format === 'json') {
        content = ImportExportService.exportToJSON(urls);
        filename = `linksnip-export-${Date.now()}.json`;
        contentType = 'application/json';
      } else {
        // Default to CSV
        content = ImportExportService.exportToCSV(urls);
        filename = `linksnip-export-${Date.now()}.csv`;
        contentType = 'text/csv';
      }

      // Log export operation
      logSecurity(ACTIONS.EXPORT_URLS, req, 'export', null, `Exported ${urls.length} URLs as ${format.toUpperCase()}`, {
        urlCount: urls.length,
        format: format,
        fileName: filename,
        isAdmin: isAdmin
      });

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(content);
    } catch (error) {
      console.error('Export error:', error);
      return res.status(500).json({
        success: false,
        error: 'Export failed',
        details: error.message
      });
    }
  }

  /**
   * GET /api/import/template - Download import template
   */
  static downloadTemplate(req, res) {
    try {
      const template = ImportExportService.generateImportTemplate();
      const filename = 'linksnip-import-template.csv';

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(template);
    } catch (error) {
      console.error('Template download error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to generate template'
      });
    }
  }
}

module.exports = ImportExportController;
