const slugService = require('../services/slugService');
const QRCodeService = require('../services/qrcodeService');
const { CONTENT_TYPES, isTypeEnabled } = require('../services/contentTypes');

/**
 * QR codes for every content type, found by slug: /qrcode/:type/:slug. Someone who can
 * ask for one already knows the address it encodes. (The old routes took an ID, so
 * counting IDs revealed every slug.) Links point at their info page, a safety preview;
 * the other types at their public page.
 */

/** The address to encode for :type/:slug, or null (unknown type, feature off, no such item). */
function qrTarget(req) {
  const { type, slug } = req.params;
  if (!isTypeEnabled(type)) return null;
  const info = CONTENT_TYPES[type];
  const item = slugService.find(type, slug);
  if (!item) return null;
  const base = `${req.protocol}://${req.get('host')}`;
  return `${base}${type === 'url' ? info.infoPrefix : info.publicPrefix}${item.slug}`;
}

const themeColors = (theme) => (theme === 'dark' ? { dark: '#34d399', light: '#0a0a0a' } : undefined);

async function sendImage(req, res, { download }) {
  const target = qrTarget(req);
  if (!target) return res.status(404).json({ error: 'Not found' });

  const { format = 'png', theme = 'light' } = req.query;
  const svg = format === 'svg';
  if (download) {
    res.setHeader('Content-Disposition', `attachment; filename="qrcode-${req.params.type}-${req.params.slug}.${svg ? 'svg' : 'png'}"`);
  }
  if (svg) {
    res.setHeader('Content-Type', 'image/svg+xml');
    return res.send(await QRCodeService.generateSVG(target));
  }
  res.setHeader('Content-Type', 'image/png');
  return res.send(await QRCodeService.generateBuffer(target, { color: themeColors(theme) }));
}

const failed = (res, error) => {
  console.error('QR code error:', error);
  res.status(500).json({ error: 'Failed to generate QR code' });
};

class QRCodeController {
  /** GET /qrcode/:type/:slug[?format=svg&theme=dark] */
  static async image(req, res) {
    try { await sendImage(req, res, { download: false }); } catch (error) { failed(res, error); }
  }

  /** GET /qrcode/:type/:slug/download */
  static async download(req, res) {
    try { await sendImage(req, res, { download: true }); } catch (error) { failed(res, error); }
  }

  /** GET /api/qrcode/:type/:slug/dataurl[?theme=dark] */
  static async dataUrl(req, res) {
    try {
      const target = qrTarget(req);
      if (!target) return res.status(404).json({ error: 'Not found' });
      res.json({ dataURL: await QRCodeService.generateThemedDataURL(target, req.query.theme || 'light'), target });
    } catch (error) {
      failed(res, error);
    }
  }
}

module.exports = QRCodeController;
