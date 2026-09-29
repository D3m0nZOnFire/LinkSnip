const QRCodeService = require('../services/qrcodeService');
const Url = require('../models/Url');

class QRCodeController {
  /**
   * Generate QR code for a URL (returns image)
   * GET /qrcode/:id
   */
  static async generateQRCode(req, res) {
    const { id } = req.params;
    const { format = 'png', theme = 'light' } = req.query;

    try {
      const url = Url.findById(id);

      if (!url) {
        return res.status(404).json({ error: 'URL not found' });
      }

      // QR codes are public (displayed on public info page)
      // No permission check needed

      // QR code points to info page for security preview
      const infoUrl = `${req.protocol}://${req.get('host')}/info/${url.slug}`;

      if (format === 'svg') {
        const svg = await QRCodeService.generateSVG(infoUrl);
        res.setHeader('Content-Type', 'image/svg+xml');
        return res.send(svg);
      }

      // Generate PNG buffer
      const buffer = await QRCodeService.generateBuffer(infoUrl, {
        color: theme === 'dark' ? {
          dark: '#34d399',
          light: '#0a0a0a'
        } : undefined
      });

      res.setHeader('Content-Type', 'image/png');
      res.send(buffer);
    } catch (error) {
      console.error('QR Code generation error:', error);
      res.status(500).json({ error: 'Failed to generate QR code' });
    }
  }

  /**
   * Download QR code for a URL
   * GET /qrcode/:id/download
   */
  static async downloadQRCode(req, res) {
    const { id } = req.params;
    const { format = 'png', theme = 'light' } = req.query;

    try {
      const url = Url.findById(id);

      if (!url) {
        return res.status(404).json({ error: 'URL not found' });
      }

      // QR codes are public (can be downloaded from public info page)
      // No permission check needed

      // QR code points to info page for security preview
      const infoUrl = `${req.protocol}://${req.get('host')}/info/${url.slug}`;
      const filename = `qrcode-${url.slug}.${format === 'svg' ? 'svg' : 'png'}`;

      if (format === 'svg') {
        const svg = await QRCodeService.generateSVG(infoUrl);
        res.setHeader('Content-Type', 'image/svg+xml');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(svg);
      }

      // Generate PNG buffer
      const buffer = await QRCodeService.generateBuffer(infoUrl, {
        color: theme === 'dark' ? {
          dark: '#34d399',
          light: '#0a0a0a'
        } : undefined,
        width: 1024 // High resolution for download
      });

      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (error) {
      console.error('QR Code download error:', error);
      res.status(500).json({ error: 'Failed to download QR code' });
    }
  }

  /**
   * Get QR code as data URL (for embedding in pages)
   * GET /api/qrcode/:id/dataurl
   */
  static async getQRCodeDataURL(req, res) {
    const { id } = req.params;
    const { theme = 'light' } = req.query;

    try {
      const url = Url.findById(id);

      if (!url) {
        return res.status(404).json({ error: 'URL not found' });
      }

      // QR codes are public (used on public info page)
      // No permission check needed

      // QR code points to info page for security preview
      const infoUrl = `${req.protocol}://${req.get('host')}/info/${url.slug}`;
      const dataURL = await QRCodeService.generateThemedDataURL(infoUrl, theme);

      res.json({ dataURL, infoUrl });
    } catch (error) {
      console.error('QR Code data URL error:', error);
      res.status(500).json({ error: 'Failed to generate QR code' });
    }
  }
}

module.exports = QRCodeController;
