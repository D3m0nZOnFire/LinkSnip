const nodemailer = require('nodemailer');

/**
 * Sends LinkSnip's mails: address verification, password reset, security notices.
 *
 * Off until configure() gets a setup (app.js passes config/env.js readMailConfig(); null = mail off). Links in
 * mails come from link(), which always starts with PUBLIC_URL, never with the request's Host header.
 *
 * SMTP goes through a pool limited to 4 mails a minute (hosting providers cap outgoing mail; Hostinger allows 5).
 * Requests use deliver(): the mail goes out in the background and a failure is logged, never thrown, so a reset
 * request answers the same way (and as fast) whether or not a mail was sent.
 */

let config = null;
let transport = null;

function buildTransport(setup) {
  if (setup.transport === 'console') return nodemailer.createTransport({ jsonTransport: true });
  return nodemailer.createTransport({
    host: setup.host,
    port: setup.port,
    secure: setup.secure,
    requireTLS: !setup.secure, // STARTTLS or nothing: a reset link never travels in plain text
    auth: setup.user ? { user: setup.user, pass: setup.pass } : undefined,
    pool: true,
    maxConnections: 1,
    rateDelta: 60000,
    rateLimit: 4
  });
}

/**
 * @param {object|null} setup - readMailConfig() result; null switches mail off
 * @param {{ transport?: object }} [options] - a transport with sendMail() (tests)
 */
function configure(setup, options = {}) {
  if (transport && transport.close && transport !== options.transport) transport.close();
  config = setup || null;
  transport = config ? (options.transport || buildTransport(config)) : null;
}

function isEnabled() {
  return !!config;
}

function requireEnabled() {
  if (!config) throw new Error('Mail is not configured (set SMTP_HOST, MAIL_FROM and PUBLIC_URL)');
}

/** What Admin → Settings shows about the setup (no password), or null when mail is off. */
function summary() {
  if (!config) return null;
  return {
    transport: config.transport,
    server: config.transport === 'console'
      ? 'printed to the console (MAIL_TRANSPORT=console)'
      : `${config.host}:${config.port} (${config.secure ? 'TLS' : 'STARTTLS'})`,
    from: config.from,
    replyTo: config.replyTo,
    publicUrl: config.publicUrl
  };
}

/** An address on this site for a mail: PUBLIC_URL + path. */
function link(path) {
  requireEnabled();
  return `${config.publicUrl}${path}`;
}

/**
 * Sends one mail and waits for the server to accept it.
 * @param {{ to: string, subject: string, text: string, html?: string, headers?: object }} message
 *   headers: extra mail headers (List-Unsubscribe on notification mails)
 * @returns {Promise<object>} The transport's answer
 */
async function send({ to, subject, text, html, headers }) {
  requireEnabled();
  const mail = { from: config.from, ...(config.replyTo ? { replyTo: config.replyTo } : {}), to, subject, text };
  if (html) mail.html = html;
  if (headers) mail.headers = headers;
  const info = await transport.sendMail(mail);
  if (config.transport === 'console') {
    console.log(['', '✉️  Mail (MAIL_TRANSPORT=console, not sent)', `To: ${to}`, `Subject: ${subject}`, '', text, ''].join('\n'));
  }
  return info;
}

/**
 * Sends in the background (for requests). Never rejects; a failure is logged with the recipient and subject only.
 * @returns {Promise<boolean>} Whether the server accepted it
 */
function deliver(message) {
  if (!config) return Promise.resolve(false);
  let sending;
  try {
    sending = send(message);
  } catch (error) {
    sending = Promise.reject(error);
  }
  return sending.then(() => true, (error) => {
    console.error(`Mail to ${message.to} ("${message.subject}") failed: ${error.message}`);
    return false;
  });
}

module.exports = { configure, isEnabled, summary, link, send, deliver };
