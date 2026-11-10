/**
 * The mails LinkSnip sends. Each template returns { subject, text, html }: the plain text says everything, the HTML
 * is the same in a simple layout (no images, no styles from elsewhere, no tracking). Every value is escaped.
 */

const escapeHtml = (value) => String(value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// LinkSnip Light, for when no theme is given (services/accountEmail.js mailTheme() passes the site's light palette)
const DEFAULT_THEME = {
  background: '#f4f6f5', card: '#ffffff', text: '#111917', muted: '#5b6662', border: '#e0e5e3',
  accent: '#047857', accentText: '#ffffff'
};
// Geist like the site where the mail app has it (few load web fonts), else the system font
const FONT = "Geist,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";

/**
 * @param {{ siteName: string, subject: string, paragraphs: Array<string|{ link: string, label: string }>,
 *   replyTo?: string|null, theme?: object }} mail
 * Strings are paragraphs; { link, label } is a button (the link is also written out, for mail apps that hide it);
 * { notice, link?, unsubscribe? } is one notification (its sentence, a link to the item, a link to stop such mails);
 * { note, link, label } is a small line with a text link.
 * replyTo (MAIL_REPLY_TO) is named as the address for questions; the sender itself takes no replies.
 */
function compose({ siteName, subject, paragraphs, replyTo = null, theme = DEFAULT_THEME, darkTheme = null }) {
  const t = { ...DEFAULT_THEME, ...theme };
  const footer = "Automatic message, please don't reply." + (replyTo ? ` Questions: ${replyTo}` : '');
  const text = [
    ...paragraphs.map(textBlock),
    '--',
    footer
  ].join('\n\n');

  // Inline styles carry the light palette (every mail app reads them); the classes let mail apps that support
  // prefers-color-scheme (Apple Mail and others) switch to the dark palette. Others apply their own dark mode.
  const block = (p) => {
    if (typeof p === 'string') return `<p style="margin:0 0 16px">${escapeHtml(p)}</p>`;
    if (p.notice !== undefined) {
      const links = [
        p.link ? `<a class="ls-link" href="${escapeHtml(p.link)}" style="color:${t.accent}">Open</a>` : '',
        p.unsubscribe ? `<a class="ls-link" href="${escapeHtml(p.unsubscribe)}" style="color:${t.muted}">Stop mails like this</a>` : ''
      ].filter(Boolean).join(' &nbsp;·&nbsp; ');
      return `<div style="margin:0 0 16px;padding:0 0 16px;border-bottom:1px solid ${t.border}">` +
        `<p style="margin:0">${escapeHtml(p.notice)}</p>` +
        (links ? `<p class="ls-muted" style="margin:6px 0 0;font-size:13px;color:${t.muted}">${links}</p>` : '') +
        '</div>';
    }
    if (p.note !== undefined) {
      return `<p class="ls-muted" style="margin:0 0 12px;font-size:13px;color:${t.muted}">${escapeHtml(p.note)} ` +
        `<a class="ls-link" href="${escapeHtml(p.link)}" style="color:${t.accent}">${escapeHtml(p.label)}</a></p>`;
    }
    const href = escapeHtml(p.link);
    return `<p style="margin:8px 0 20px"><a class="ls-btn" href="${href}" style="display:inline-block;padding:10px 18px;` +
      `background:${t.accent};color:${t.accentText};font-weight:500;text-decoration:none;border-radius:8px">` +
      `${escapeHtml(p.label)}</a></p>` +
      `<p class="ls-muted" style="margin:0 0 16px;font-size:13px;color:${t.muted}">Or open this address: ` +
      `<a class="ls-link" href="${href}" style="color:${t.accent};word-break:break-all">${href}</a></p>`;
  };
  const html = '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">' +
    darkStyle(darkTheme) + '</head>' +
    `<body class="ls-bg" style="margin:0;padding:32px 16px;background:${t.background}">` +
    `<div class="ls-text" style="max-width:520px;margin:0 auto;font-family:${FONT};font-size:15px;line-height:1.55;color:${t.text}">` +
    `<p style="margin:0 0 16px;font-size:18px;font-weight:700;letter-spacing:-0.01em;text-align:center">${escapeHtml(siteName)}</p>` +
    `<div class="ls-card" style="padding:28px 24px;background:${t.card};border:1px solid ${t.border};border-radius:12px">` +
    paragraphs.map(block).join('') +
    '</div>' +
    `<p class="ls-muted" style="margin:16px 0 0;font-size:12px;color:${t.muted};text-align:center">${escapeHtml(footer)}</p>` +
    '</div></body></html>';

  return { subject, text, html };
}

/** Plain-text version of a paragraph. */
function textBlock(p) {
  if (typeof p === 'string') return p;
  if (p.notice !== undefined) {
    return [`- ${p.notice}`, p.link ? `  Open: ${p.link}` : null, p.unsubscribe ? `  Stop mails like this: ${p.unsubscribe}` : null]
      .filter(Boolean).join('\n');
  }
  if (p.note !== undefined) return `${p.note} ${p.link}`;
  return `${p.label}:\n${p.link}`;
}

/** The dark palette as a prefers-color-scheme block (colors only: theme values are hex from paletteService). */
function darkStyle(d) {
  if (!d) return '';
  const hex = (value) => (/^#[0-9a-fA-F]{3,8}$/.test(String(value)) ? value : null);
  const rules = [
    ['.ls-bg', `background:${hex(d.background)} !important`],
    ['.ls-card', `background:${hex(d.card)} !important;border-color:${hex(d.border)} !important`],
    ['.ls-text', `color:${hex(d.text)} !important`],
    ['.ls-muted', `color:${hex(d.muted)} !important`],
    ['.ls-btn', `background:${hex(d.accent)} !important;color:${hex(d.accentText)} !important`],
    ['.ls-link', `color:${hex(d.accent)} !important`]
  ];
  if (rules.some(([, css]) => css.includes('null'))) return '';
  return `<style>@media (prefers-color-scheme: dark) { ${rules.map(([sel, css]) => `${sel}{${css}}`).join(' ')} }</style>`;
}

const NOT_YOU = "If this wasn't you, you can ignore this mail.";

/** Confirms an address (24 hours). */
function verifyEmail({ siteName, username, url, replyTo, theme, darkTheme }) {
  return compose({
    siteName,
    replyTo,
    theme,
    darkTheme,
    subject: `Confirm your email address for ${siteName}`,
    paragraphs: [
      `Hi ${username},`,
      `Please confirm that this is your email address for your ${siteName} account. ` +
        'It lets you reset your password if you forget it.',
      { link: url, label: 'Confirm email address' },
      `The link works for 24 hours. ${NOT_YOU}`
    ]
  });
}

/** To the old (verified) address when the account's address changes. */
function emailChanged({ siteName, username, newEmail, replyTo, theme, darkTheme }) {
  return compose({
    siteName,
    replyTo,
    theme,
    darkTheme,
    subject: `Your ${siteName} email address was changed`,
    paragraphs: [
      `Hi ${username},`,
      `The email address of your ${siteName} account was changed to ${newEmail}. ` +
        'Password reset mails now go to that address once it is confirmed.',
      "If this wasn't you, log in and change your password and email address right away, " +
        "or contact the site's administrator."
    ]
  });
}

/** Admin → Settings → Send test email. */
function testMail({ siteName, username, replyTo, theme, darkTheme }) {
  return compose({
    siteName,
    replyTo,
    theme,
    darkTheme,
    subject: `Test email from ${siteName}`,
    paragraphs: [
      `Hi ${username},`,
      `This is a test from ${siteName}. Mail is set up correctly: password reset and address verification mails ` +
        'will be delivered.'
    ]
  });
}

/** Forgot password: the link to the form (30 minutes, once). */
function resetPassword({ siteName, username, url, replyTo, theme, darkTheme }) {
  return compose({
    siteName,
    replyTo,
    theme,
    darkTheme,
    subject: `Reset your password for ${siteName}`,
    paragraphs: [
      `Hi ${username},`,
      `Someone asked to reset the password of your ${siteName} account. To choose a new one, open this link:`,
      { link: url, label: 'Choose a new password' },
      'The link works for 30 minutes and only once. Choosing a new password logs you out everywhere else.',
      `If you didn't ask for this, ignore this mail: your password stays as it is.`
    ]
  });
}

/** After a reset or a change in Settings. */
function passwordChanged({ siteName, username, replyTo, theme, darkTheme }) {
  return compose({
    siteName,
    replyTo,
    theme,
    darkTheme,
    subject: `Your ${siteName} password was changed`,
    paragraphs: [
      `Hi ${username},`,
      `The password of your ${siteName} account was just changed, and every other session was logged out.`,
      "If this wasn't you, reset your password right away with \"Forgot password?\" on the login page, " +
        "or contact the site's administrator."
    ]
  });
}

/** A notice as a subject: whole when short, else up to its first clause (or the last whole word). */
function shortSubject(text, max = 90) {
  if (text.length <= max) return text;
  const clause = text.match(/^(.+?)[:.;](\s|$)/);
  if (clause && clause[1].length <= max) return clause[1];
  return `${text.slice(0, max - 3).replace(/\s+\S*$/, '')}...`;
}

/**
 * Notifications (services/notificationService.js sendDue): one or more, each with its link and how to stop such mails.
 * pageUrl / settingsUrl: the Notifications page and the preferences (null for a banned account, which can't log in).
 * @param {{ items: Array<{ text: string, url: string|null, unsubscribe: string|null }> }} data
 */
function notifications({ siteName, username, items, pageUrl, settingsUrl, replyTo, theme, darkTheme }) {
  const subject = items.length === 1
    ? `${siteName}: ${shortSubject(items[0].text)}`
    : `${siteName}: ${items.length} notifications`;
  return compose({
    siteName,
    replyTo,
    theme,
    darkTheme,
    subject,
    paragraphs: [
      `Hi ${username},`,
      ...items.map(item => ({ notice: item.text, link: item.url, unsubscribe: item.unsubscribe })),
      ...(pageUrl ? [{ note: 'All your notifications:', link: pageUrl, label: pageUrl }] : []),
      ...(settingsUrl ? [{ note: 'Choose what you get by mail:', link: settingsUrl, label: settingsUrl }] : [])
    ]
  });
}

module.exports = { notifications, verifyEmail, emailChanged, testMail, resetPassword, passwordChanged, escapeHtml, compose, DEFAULT_THEME };
