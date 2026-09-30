const { hashIp } = require('./ipHash');
const AnalyticsEvent = require('../models/AnalyticsEvent');
const geo = require('./geoService');

class AnalyticsService {
  /**
   * Extract IP address from request
   * @param {object} req - Express request object
   * @returns {string} IP address
   */
  static getIpAddress(req) {
    // req.ip is resolved through TRUST_PROXY; X-Forwarded-For as sent can be written by anyone
    return req.ip || 'unknown';
  }

  /**
   * Parse user agent to extract browser, OS, and device type
   * @param {string} userAgent
   * @returns {object} { browser, os, device }
   */
  static parseUserAgent(userAgent) {
    if (!userAgent) {
      return { browser: 'Unknown', os: 'Unknown', device: 'Unknown' };
    }

    const ua = userAgent.toLowerCase();

    // Detect browser
    let browser = 'Other';
    if (ua.includes('edg/')) browser = 'Edge';
    else if (ua.includes('chrome/') && !ua.includes('edg/')) browser = 'Chrome';
    else if (ua.includes('firefox/')) browser = 'Firefox';
    else if (ua.includes('safari/') && !ua.includes('chrome/')) browser = 'Safari';
    else if (ua.includes('opera/') || ua.includes('opr/')) browser = 'Opera';
    else if (ua.includes('msie') || ua.includes('trident/')) browser = 'Internet Explorer';

    // Detect OS
    let os = 'Other';
    if (ua.includes('windows nt 10.0')) os = 'Windows 10';
    else if (ua.includes('windows nt 6.3')) os = 'Windows 8.1';
    else if (ua.includes('windows nt 6.2')) os = 'Windows 8';
    else if (ua.includes('windows nt 6.1')) os = 'Windows 7';
    else if (ua.includes('windows')) os = 'Windows';
    else if (ua.includes('mac os x')) os = 'macOS';
    else if (ua.includes('android')) os = 'Android';
    else if (ua.includes('iphone') || ua.includes('ipad')) os = 'iOS';
    else if (ua.includes('linux')) os = 'Linux';
    else if (ua.includes('cros')) os = 'Chrome OS';

    // Detect device type
    let device = 'Desktop';
    if (ua.includes('mobile') || ua.includes('android')) device = 'Mobile';
    else if (ua.includes('tablet') || ua.includes('ipad')) device = 'Tablet';
    else if (ua.includes('bot') || ua.includes('crawler') || ua.includes('spider')) device = 'Bot';

    return { browser, os, device };
  }

  /**
   * The visit details of a request (hashed IP, referrer, user agent and what it parses to, country)
   * @param {object} req - Express request object
   * @returns {Promise<object>} Fields for AnalyticsEvent.record
   */
  static async captureAnalytics(req) {
    const ip = this.getIpAddress(req);
    const ipHash = hashIp(ip);
    const referrer = req.headers.referer || req.headers.referrer || 'Direct';
    const userAgent = req.headers['user-agent'] || '';
    const { browser, os, device } = this.parseUserAgent(userAgent);
    const country = geo.lookupCountry(ip);

    return {
      ipHash,
      referrer,
      userAgent: userAgent.substring(0, 255), // Limit length
      browser,
      os,
      device,
      country
    };
  }

  /**
   * Record one visit of an item (the one capture path for every type).
   * @param {string} type - content type (url, bundle, paste, file)
   * @param {number} id - the item
   * @param {number|null} subId - a bundle item, for clicks on a bundle's items
   */
  static async record(req, type, id, subId = null) {
    const details = await this.captureAnalytics(req);
    return AnalyticsEvent.record({ targetType: type, targetId: id, subTargetId: subId, ...details });
  }
}

module.exports = AnalyticsService;
