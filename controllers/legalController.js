const configService = require('../services/configService');
const { isEnabled } = require('../middleware/requireFeature');

/**
 * /privacy and /terms, for the people who use and visit the instance. Every fact comes from the live settings, so
 * the pages say what this instance actually does (docs/PRIVACY.md is the operator's version).
 */

/**
 * How `legal.contact` is shown: a mailto link for an e-mail address, a link for an https:// page, else plain text.
 * @returns {{ href: string|null, text: string }|null} null when it's empty
 */
function contactLink(value) {
  const text = (value || '').trim();
  if (!text) return null;
  if (/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(text)) return { href: `mailto:${text}`, text };
  if (/^https:\/\/[^\s<>"]+$/.test(text)) return { href: text, text };
  return { href: null, text };
}

function common() {
  return {
    contact: contactLink(configService.get('legal.contact')),
    reports: isEnabled('reports')
  };
}

class LegalController {
  static privacyPage(req, res) {
    res.render('privacy', {
      title: 'Privacy',
      ...common(),
      analytics: isEnabled('analytics'),
      geo: configService.get('geo.enabled'),
      analyticsDays: configService.get('retention.analyticsDays'),
      auditLogDays: configService.get('retention.auditLogDays'),
      bioPages: isEnabled('bioPages'),
      files: isEnabled('files')
    });
  }

  static termsPage(req, res) {
    res.render('terms', {
      title: 'Terms',
      ...common(),
      urlDays: configService.get('anonymous.urlExpirationDays'),
      pasteDays: configService.get('anonymous.pasteExpirationDays'),
      pastes: isEnabled('pastes'),
      registrationOpen: configService.get('registration.open')
    });
  }
}

LegalController.contactLink = contactLink;
module.exports = LegalController;
