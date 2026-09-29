const Papa = require('papaparse');
const { stringify } = require('csv-stringify/sync');

/**
 * Import/Export Service for LinkSnip
 *
 * Handles bulk import and export of URLs in multiple formats:
 * - CSV (with various column configurations)
 * - JSON
 * - Plain text (one URL per line)
 *
 * Supports flexible import formats:
 * 1. Simple: Just URLs (one per line or in CSV)
 * 2. With slugs: longUrl,slug
 * 3. With tags: longUrl,slug,tags (tags separated by semicolons: tag1;tag2;tag3)
 * 4. With expiration: longUrl,slug,tags,expirationDays
 * 5. With max uses: longUrl,slug,tags,expirationDays,maxUses
 * 6. Full format: longUrl,slug,tags,expirationDays,maxUses
 *
 * IMPORTANT: Tags must be separated by SEMICOLONS (;) not commas, since commas
 * are used to separate CSV columns. Example: "marketing;campaign;email"
 */

class ImportExportService {
  /**
   * Parse imported file content and extract URLs with metadata
   *
   * @param {string} content - File content (CSV, JSON, or plain text)
   * @param {string} fileType - File extension (csv, json, txt)
   * @returns {Object} { success, data: Array, errors: Array }
   */
  static parseImportFile(content, fileType) {
    try {
      if (fileType === 'json') {
        return this.parseJSON(content);
      } else if (fileType === 'csv') {
        return this.parseCSV(content);
      } else if (fileType === 'txt') {
        return this.parseText(content);
      } else {
        // Try to auto-detect format
        return this.autoDetectAndParse(content);
      }
    } catch (error) {
      return {
        success: false,
        data: [],
        errors: [`Failed to parse file: ${error.message}`]
      };
    }
  }

  /**
   * Parse JSON format
   * Expects array of objects with: longUrl, slug?, tags?, expirationDays?, maxUses?
   */
  static parseJSON(content) {
    try {
      const data = JSON.parse(content);

      if (!Array.isArray(data)) {
        return {
          success: false,
          data: [],
          errors: ['JSON must be an array of URL objects']
        };
      }

      const results = [];
      const errors = [];

      data.forEach((item, index) => {
        const lineNum = index + 1;

        if (typeof item === 'string') {
          // Simple array of URLs
          results.push(this.createURLObject(item));
        } else if (typeof item === 'object' && item.longUrl) {
          // Object with longUrl and optional fields
          results.push(this.createURLObject(
            item.longUrl,
            item.slug,
            item.tags,
            item.expirationDays,
            item.maxUses
          ));
        } else {
          errors.push(`Line ${lineNum}: Invalid format - missing longUrl field`);
        }
      });

      return {
        success: errors.length === 0,
        data: results,
        errors
      };
    } catch (error) {
      return {
        success: false,
        data: [],
        errors: [`Invalid JSON format: ${error.message}`]
      };
    }
  }

  /**
   * Parse CSV format
   * Supports multiple column configurations
   */
  static parseCSV(content) {
    const parsed = Papa.parse(content, {
      header: false,
      skipEmptyLines: true,
      trim: true
    });

    if (parsed.errors.length > 0) {
      return {
        success: false,
        data: [],
        errors: parsed.errors.map(e => `Line ${e.row}: ${e.message}`)
      };
    }

    const results = [];
    const errors = [];
    let hasHeader = false;

    // Check if first row is a header
    const firstRow = parsed.data[0];
    if (firstRow && firstRow.length > 0) {
      const firstCell = String(firstRow[0]).toLowerCase();
      if (firstCell.includes('url') || firstCell.includes('long')) {
        hasHeader = true;
      }
    }

    const dataRows = hasHeader ? parsed.data.slice(1) : parsed.data;

    dataRows.forEach((row, index) => {
      const lineNum = index + (hasHeader ? 2 : 1); // Account for header

      if (!row || row.length === 0 || !row[0]) {
        return; // Skip empty rows
      }

      try {
        const longUrl = row[0];
        const slug = row[1] || undefined;
        const tags = row[2] || undefined;
        const expirationDays = row[3] ? parseInt(row[3]) : undefined;
        const maxUses = row[4] ? parseInt(row[4]) : undefined;

        results.push(this.createURLObject(longUrl, slug, tags, expirationDays, maxUses));
      } catch (error) {
        errors.push(`Line ${lineNum}: ${error.message}`);
      }
    });

    return {
      success: errors.length === 0,
      data: results,
      errors
    };
  }

  /**
   * Parse plain text format (one URL per line)
   */
  static parseText(content) {
    const lines = content.split(/\r?\n/).filter(line => line.trim());
    const results = [];
    const errors = [];

    lines.forEach((line, index) => {
      const lineNum = index + 1;
      const trimmed = line.trim();

      if (!trimmed) return;

      // Check if line contains comma (might be CSV-like)
      if (trimmed.includes(',')) {
        const parts = trimmed.split(',').map(p => p.trim());
        results.push(this.createURLObject(
          parts[0],
          parts[1],
          parts[2],
          parts[3] ? parseInt(parts[3]) : undefined,
          parts[4] ? parseInt(parts[4]) : undefined
        ));
      } else {
        // Just a URL
        results.push(this.createURLObject(trimmed));
      }
    });

    return {
      success: errors.length === 0,
      data: results,
      errors
    };
  }

  /**
   * Auto-detect format and parse
   */
  static autoDetectAndParse(content) {
    // Try JSON first
    if (content.trim().startsWith('[') || content.trim().startsWith('{')) {
      const jsonResult = this.parseJSON(content);
      if (jsonResult.success) return jsonResult;
    }

    // Try CSV
    if (content.includes(',')) {
      const csvResult = this.parseCSV(content);
      if (csvResult.data.length > 0) return csvResult;
    }

    // Default to plain text
    return this.parseText(content);
  }

  /**
   * Create standardized URL object
   */
  static createURLObject(longUrl, slug, tags, expirationDays, maxUses) {
    // Validate URL format
    try {
      new URL(longUrl);
    } catch (error) {
      throw new Error(`Invalid URL format: ${longUrl}`);
    }

    return {
      longUrl: longUrl.trim(),
      slug: slug && slug.trim() !== '' ? slug.trim() : undefined,
      tags: tags && tags.trim() !== '' ? tags.trim() : undefined,
      expirationDays: expirationDays && !isNaN(expirationDays) && expirationDays > 0 ? parseInt(expirationDays) : undefined,
      maxUses: maxUses && !isNaN(maxUses) && maxUses > 0 ? parseInt(maxUses) : undefined
    };
  }

  /**
   * Validate parsed data before import
   *
   * @param {Array} data - Array of URL objects
   * @param {number} maxUrls - Maximum allowed URLs per import
   * @returns {Object} { valid: boolean, errors: Array }
   */
  static validateImportData(data, maxUrls = 1000) {
    const errors = [];

    if (!Array.isArray(data) || data.length === 0) {
      errors.push('No valid URLs found in file');
      return { valid: false, errors };
    }

    if (data.length > maxUrls) {
      errors.push(`Too many URLs. Maximum ${maxUrls} per import, found ${data.length}`);
      return { valid: false, errors };
    }

    // Check for duplicate URLs in import
    const urlMap = new Map();
    data.forEach((item, index) => {
      if (urlMap.has(item.longUrl)) {
        errors.push(`Duplicate URL at line ${index + 1}: ${item.longUrl}`);
      } else {
        urlMap.set(item.longUrl, index + 1);
      }
    });

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Export URLs to CSV format
   *
   * @param {Array} urls - Array of URL objects from database
   * @returns {string} CSV content
   */
  static exportToCSV(urls) {
    const data = urls.map(url => ({
      'Short URL': url.slug,
      'Long URL': url.longUrl,
      'Clicks': url.clicks || 0,
      'Max Uses': url.maxUses || 'Unlimited',
      'Expires At': url.expiresAt || 'Never',
      'Created At': url.createdAt,
      'Tags': url.tags ? url.tags.map(t => t.name).join(';') : '',
      'Status': url.isBlocked ? 'Blocked' : 'Active'
    }));

    return stringify(data, {
      header: true,
      columns: [
        'Short URL',
        'Long URL',
        'Clicks',
        'Max Uses',
        'Expires At',
        'Created At',
        'Tags',
        'Status'
      ]
    });
  }

  /**
   * Export URLs to JSON format
   *
   * @param {Array} urls - Array of URL objects from database
   * @returns {string} JSON content
   */
  static exportToJSON(urls) {
    const data = urls.map(url => ({
      slug: url.slug,
      longUrl: url.longUrl,
      clicks: url.clicks || 0,
      maxUses: url.maxUses || null,
      expiresAt: url.expiresAt || null,
      createdAt: url.createdAt,
      tags: url.tags ? url.tags.map(t => t.name) : [],
      isBlocked: url.isBlocked ? true : false
    }));

    return JSON.stringify(data, null, 2);
  }

  /**
   * Generate import template CSV
   *
   * @returns {string} Template CSV with examples
   */
  static generateImportTemplate() {
    const template = [
      ['longUrl', 'slug', 'tags', 'expirationDays', 'maxUses'],
      ['https://example.com/page1', 'example1', 'marketing;campaign;email', '30', '100'],
      ['https://example.com/page2', 'example2', 'social-media;twitter', '60', ''],
      ['https://example.com/page3', '', 'product;launch', '', '50'],
      ['https://example.com/page4', '', '', '', '']
    ];

    return stringify(template, { header: false });
  }
}

module.exports = ImportExportService;
