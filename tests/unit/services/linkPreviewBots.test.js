const { isPreviewBot } = require('../../../services/linkPreviewBots');

const withAgent = (userAgent) => ({ headers: userAgent === undefined ? {} : { 'user-agent': userAgent } });

describe('isPreviewBot: the servers that fetch a shared link to build its preview', () => {
  it.each([
    ['WhatsApp (Android)', 'WhatsApp/2.23.20.0 A'],
    ['WhatsApp (iOS); Signal sends the same', 'WhatsApp/2.2329.7 i'],
    ['Facebook / Messenger / Instagram', 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'],
    ['iMessage', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_1) AppleWebKit/601.2.4 (KHTML, like Gecko) Version/9.0.1 Safari/601.2.4 facebookexternalhit/1.1 Facebot Twitterbot/1.0'],
    ['Telegram', 'TelegramBot (like TwitterBot)'],
    ['Slack', 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)'],
    ['Discord', 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)'],
    ['X / Twitter', 'Twitterbot/1.0'],
    ['LinkedIn', 'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)'],
    ['Teams / Skype', 'Mozilla/5.0 (Windows NT 6.1; WOW64) SkypeUriPreview Preview/0.5 skype-url-preview@microsoft.com'],
    ['Bluesky', 'Mozilla/5.0 (compatible; Bluesky Cardyb/1.1; +mailto:support@bsky.app)'],
    ['Mastodon', 'http.rb/5.1.1 (Mastodon/4.2.0; +https://mastodon.social/) Bot'],
    ['Reddit', 'Mozilla/5.0 (compatible; redditbot/1.0; +http://www.reddit.com/feedback)'],
    ['Pinterest', 'Pinterestbot/1.0 (+http://www.pinterest.com/bot.html)'],
    ['Embedly', 'Mozilla/5.0 (compatible; Embedly/0.2; +http://support.embed.ly/)'],
    ['VK', 'Mozilla/5.0 (compatible; vkShare; +http://vk.com/dev/Share)']
  ])('%s', (_name, userAgent) => {
    expect(isPreviewBot(withAgent(userAgent))).toBe(true);
  });

  it.each([
    ['Chrome on Windows', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'],
    ['Firefox on Linux', 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0'],
    ['Safari on iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1'],
    ['Chrome on Android', 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36'],
    ["Facebook's in-app browser (a person who tapped the link)", 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0.0.0;FBBV/1]'],
    ["Instagram's in-app browser", 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36 Instagram 340.0.0.0'],
    ['curl', 'curl/8.9.1']
  ])('not %s', (_name, userAgent) => {
    expect(isPreviewBot(withAgent(userAgent))).toBe(false);
  });

  it('not a request without a user agent', () => {
    expect(isPreviewBot(withAgent(undefined))).toBe(false);
    expect(isPreviewBot({})).toBe(false);
  });
});
