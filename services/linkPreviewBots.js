/**
 * The servers that fetch a shared link to build a chat preview (WhatsApp, Telegram, Slack, …). Their fetch is not a
 * visit: public routes count nothing for it (no click/view/download, no analytics event, no usage limit used up),
 * give it no paste content, and its pages carry no logo or favicon, so the app has no image to turn into a big
 * preview picture. Recognised by user agent; a bot that pretends to be a browser simply counts as a visit.
 */
const PREVIEW_BOTS = [
  /^WhatsApp\//i, // also Signal
  /facebookexternalhit|Facebot/i, // Facebook, Messenger, Instagram, iMessage
  /TelegramBot/i,
  /Slackbot/i,
  /Discordbot/i,
  /Twitterbot/i,
  /LinkedInBot/i,
  /SkypeUriPreview/i, // Teams, Skype
  /Bluesky Cardyb/i,
  /Mastodon\//i,
  /redditbot/i,
  /Pinterestbot/i,
  /Embedly/i,
  /vkShare/i
];

/**
 * @param {object} req - an Express request (only its user agent is read)
 * @returns {boolean}
 */
function isPreviewBot(req) {
  const userAgent = (req.headers && req.headers['user-agent']) || '';
  return PREVIEW_BOTS.some(pattern => pattern.test(userAgent));
}

module.exports = { isPreviewBot };
