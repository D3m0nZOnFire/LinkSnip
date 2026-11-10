const mailTemplates = require('../../../services/mailTemplates');

// Each template gives { subject, text, html }: plain text first, simple HTML with no images or tracking.

const SITE = 'Acme <Links>';

describe('mailTemplates', () => {
  const cases = [
    ['verifyEmail', { siteName: SITE, username: 'ann', url: 'https://l.example/verify-email/T1' }, 'https://l.example/verify-email/T1'],
    ['emailChanged', { siteName: SITE, username: 'ann', newEmail: 'new@example.com' }, 'new@example.com'],
    ['testMail', { siteName: SITE, username: 'ann' }, SITE]
  ];

  it.each(cases)('%s has a subject naming the site, and text and HTML with the key detail', (name, data, detail) => {
    const mail = mailTemplates[name](data);
    expect(mail.subject).toContain(SITE);
    expect(mail.text).toContain(detail);
    expect(mail.html).toContain(detail.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
  });

  it.each(cases)('%s escapes values in the HTML and loads nothing from elsewhere', (name, data) => {
    const { html } = mailTemplates[name]({ ...data, siteName: '<script>x</script>', username: '<b>ann</b>' });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>ann</b>');
    expect(html).not.toMatch(/<img|src=|<link/i);
  });

  it('verifyEmail puts the link in an anchor and says when it expires', () => {
    const { html, text } = mailTemplates.verifyEmail({ siteName: SITE, username: 'ann', url: 'https://l.example/verify-email/T1' });
    expect(html).toContain('href="https://l.example/verify-email/T1"');
    expect(text).toMatch(/24 hours/);
  });

  it('the footer says the sender takes no replies, and names the contact address for questions when there is one', () => {
    const withContact = mailTemplates.testMail({ siteName: SITE, username: 'ann', replyTo: 'contact@example.com' });
    expect(withContact.text.split('\n').pop()).toBe("Automatic message, please don't reply. Questions: contact@example.com");
    const without = mailTemplates.testMail({ siteName: SITE, username: 'ann' });
    expect(without.text.split('\n').pop()).toBe("Automatic message, please don't reply.");
  });

  it("uses the site's colors and font: the theme's background, card, text and accent", () => {
    const theme = {
      background: '#f1f2f3', card: '#fafafa', text: '#111111', muted: '#666666', border: '#dddddd',
      accent: '#a76709', accentText: '#ffffff'
    };
    const { html } = mailTemplates.verifyEmail({ siteName: SITE, username: 'ann', url: 'https://l.example/v/T', theme });
    expect(html).toContain('background:#f1f2f3');
    expect(html).toContain('background:#fafafa');
    expect(html).toContain('background:#a76709;color:#ffffff');
    expect(html).toMatch(/font-family:Geist,/);
  });

  it("mail apps in dark mode get the site's dark palette", () => {
    const darkTheme = {
      background: '#101010', card: '#1a1a1a', text: '#eeeeee', muted: '#999999', border: '#333333',
      accent: '#34d399', accentText: '#000000'
    };
    const { html } = mailTemplates.verifyEmail({ siteName: SITE, username: 'ann', url: 'https://l.example/v/T', darkTheme });
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
    const dark = html.match(/@media \(prefers-color-scheme: dark\)\s*\{([\s\S]*?)\}\s*<\/style>/)[1];
    expect(dark).toContain('background:#34d399 !important');
    expect(dark).toContain('background:#1a1a1a !important');
    expect(html).toMatch(/class="ls-btn"/);
  });

  it('Outlook in dark mode (on the web, new Outlook) gets the dark palette instead of its own grays', () => {
    // Outlook applies the prefers-color-scheme block, but rewrites backgrounds inline with !important, which no
    // stylesheet beats, and drops background-image. An inset box-shadow paints over them. Checked in Outlook on the web.
    const darkTheme = {
      background: '#101010', card: '#1a1a1a', text: '#eeeeee', muted: '#999999', border: '#333333',
      accent: '#34d399', accentText: '#000000'
    };
    const { html } = mailTemplates.verifyEmail({ siteName: SITE, username: 'ann', url: 'https://l.example/v/T', darkTheme });
    const dark = html.match(/@media \(prefers-color-scheme: dark\)\s*\{([\s\S]*?)\}\s*<\/style>/)[1];
    const rule = (selector) => dark.match(new RegExp(`\\${selector}\\{([^}]*)\\}`))[1];
    expect(rule('.ls-bg')).toContain('box-shadow:inset 0 0 0 2000px #101010 !important');
    expect(rule('.ls-card')).toContain('box-shadow:inset 0 0 0 2000px #1a1a1a !important');
    // The button is left to Outlook: it also forces the button's text color (white) and drops
    // -webkit-text-fill-color, so painting the palette's light green would put white text on it
    expect(rule('.ls-btn')).not.toContain('box-shadow');
    expect(dark).not.toContain('background-image'); // Outlook drops it
    expect(rule('.ls-sep')).toContain('border-color:#333333 !important');
  });

  it('falls back to LinkSnip Light without a theme', () => {
    const { html } = mailTemplates.verifyEmail({ siteName: SITE, username: 'ann', url: 'https://l.example/v/T' }); // has a button
    expect(html).toContain('background:#047857');
  });

  it('emailChanged tells the old address to act if it was not them', () => {
    expect(mailTemplates.emailChanged({ siteName: SITE, username: 'ann', newEmail: 'n@example.com' }).text)
      .toMatch(/If this wasn't you/);
  });
});

describe('password mails', () => {
  it('resetPassword links the form, says it works for 30 minutes and once', () => {
    const { subject, text, html } = mailTemplates.resetPassword({ siteName: SITE, username: 'ann', url: 'https://l.example/reset-password/T' });
    expect(subject).toMatch(/Reset your password/);
    expect(text).toContain('https://l.example/reset-password/T');
    expect(text).toMatch(/30 minutes/);
    expect(html).toContain('href="https://l.example/reset-password/T"');
  });

  it("passwordChanged says what to do if it wasn't them", () => {
    const { subject, text } = mailTemplates.passwordChanged({ siteName: SITE, username: 'ann' });
    expect(subject).toMatch(/password was changed/i);
    expect(text).toMatch(/If this wasn't you/);
  });
});

describe('notification mails', () => {
  const items = [
    { text: 'Your link /s/a was blocked <by an admin>.', url: 'https://l.example/info/a', unsubscribe: 'https://l.example/notifications/unsubscribe/K/blocked' },
    { text: 'Your link /s/b was deleted.', url: null, unsubscribe: 'https://l.example/notifications/unsubscribe/K/deleted_by_cleanup' }
  ];

  it('marks the lines between notices, so dark mode can recolor them', () => {
    const darkTheme = {
      background: '#101010', card: '#1a1a1a', text: '#eeeeee', muted: '#999999', border: '#333333',
      accent: '#34d399', accentText: '#000000'
    };
    const { html } = mailTemplates.notifications({ siteName: SITE, username: 'ann', items, pageUrl: 'p', settingsUrl: 's', darkTheme });
    expect(html.match(/class="ls-sep"[^>]*border-bottom/g)).toHaveLength(items.length);
  });

  it('lists every item with its link, the notifications page and how to stop each kind', () => {
    const mail = mailTemplates.notifications({
      siteName: SITE, username: 'ann', items, pageUrl: 'https://l.example/notifications',
      settingsUrl: 'https://l.example/settings#notifications'
    });
    expect(mail.subject).toContain(SITE);
    expect(mail.subject).toMatch(/2 notifications/);
    expect(mail.text).toContain('Your link /s/a was blocked <by an admin>.');
    expect(mail.text).toContain('https://l.example/info/a');
    expect(mail.text).toContain('https://l.example/notifications');
    expect(mail.text).toContain('https://l.example/notifications/unsubscribe/K/blocked');
    expect(mail.text).toContain('https://l.example/settings#notifications');
    expect(mail.html).toContain('blocked &lt;by an admin&gt;.');
    expect(mail.html).not.toContain('<by an admin>');
  });

  it('uses the one item as subject when there is only one', () => {
    const mail = mailTemplates.notifications({ siteName: SITE, username: 'ann', items: [items[1]], pageUrl: 'p', settingsUrl: 's' });
    expect(mail.subject).toContain('Your link /s/b was deleted.');
  });

  it('ends a long one-item subject at its first clause, not mid-word', () => {
    const text = 'Your account was suspended by an administrator: you can\'t log in any more, and your links, bundles, pastes and files no longer open.';
    const mail = mailTemplates.notifications({ siteName: SITE, username: 'ann', items: [{ text, url: null, unsubscribe: null }], pageUrl: null, settingsUrl: null });
    expect(mail.subject).toBe(`${SITE}: Your account was suspended by an administrator`);
  });

  it('leaves the page and settings links out when there are none (a banned account cannot log in)', () => {
    const mail = mailTemplates.notifications({ siteName: SITE, username: 'ann', items: [{ text: 'Your account was suspended.', url: null, unsubscribe: null }], pageUrl: null, settingsUrl: null });
    expect(mail.text).not.toMatch(/notifications|settings/i);
  });
});
