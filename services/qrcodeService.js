const QRCode = require('qrcode');

class QRCodeService {
  /**
   * Generate QR code as data URL
   * @param {string} url - The URL to encode
   * @param {object} options - QR code options
   * @returns {Promise<string>} Data URL of the QR code
   */
  static async generateDataURL(url, options = {}) {
    const defaultOptions = {
      errorCorrectionLevel: 'M',
      type: 'image/png',
      quality: 0.92,
      margin: 1,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      },
      width: 300,
      ...options
    };

    try {
      return await QRCode.toDataURL(url, defaultOptions);
    } catch (error) {
      console.error('QR Code generation error:', error);
      throw new Error('Failed to generate QR code');
    }
  }

  /**
   * Generate QR code as buffer (for download)
   * @param {string} url - The URL to encode
   * @param {object} options - QR code options
   * @returns {Promise<Buffer>} PNG buffer
   */
  static async generateBuffer(url, options = {}) {
    const defaultOptions = {
      errorCorrectionLevel: 'M',
      type: 'image/png',
      quality: 0.92,
      margin: 1,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      },
      width: 512, // Higher resolution for downloads
      ...options
    };

    try {
      return await QRCode.toBuffer(url, defaultOptions);
    } catch (error) {
      console.error('QR Code buffer generation error:', error);
      throw new Error('Failed to generate QR code');
    }
  }

  /**
   * Generate QR code as SVG string
   * @param {string} url - The URL to encode
   * @param {object} options - QR code options
   * @returns {Promise<string>} SVG string
   */
  static async generateSVG(url, options = {}) {
    const defaultOptions = {
      errorCorrectionLevel: 'M',
      type: 'svg',
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      },
      ...options
    };

    try {
      return await QRCode.toString(url, defaultOptions);
    } catch (error) {
      console.error('QR Code SVG generation error:', error);
      throw new Error('Failed to generate QR code SVG');
    }
  }

  /**
   * Generate themed QR code with custom colors
   * @param {string} url - The URL to encode
   * @param {string} theme - 'light' or 'dark'
   * @returns {Promise<string>} Data URL of the QR code
   */
  static async generateThemedDataURL(url, theme = 'light') {
    const themeColors = {
      light: {
        dark: '#000000',
        light: '#FFFFFF'
      },
      dark: {
        dark: '#34d399', // Green accent from your theme
        light: '#0a0a0a'  // Dark background
      }
    };

    return await this.generateDataURL(url, {
      color: themeColors[theme] || themeColors.light
    });
  }
}

module.exports = QRCodeService;
