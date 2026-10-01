const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../config/database');
const paths = require('../config/paths');
const Url = require('../models/Url');
const Bundle = require('../models/Bundle');
const Paste = require('../models/Paste');
const File = require('../models/File');
const Tag = require('../models/Tag');
const User = require('../models/User');
const BioPage = require('../models/BioPage');
const AnalyticsShare = require('../models/AnalyticsShare');
const AuditLog = require('../models/AuditLog');
const teamService = require('../services/teamService');
const { contentType } = require('../services/contentTypes');

/**
 * Demo data for trying LinkSnip out (npm run seed:demo, scripts/seed-demo.js): accounts of every kind, items of
 * every type in every status, teams, tags, reports, a month of visits, share links, a bio page and audit history.
 * Deterministic: the same data every time. Every account and every password-protected item uses DEMO_PASSWORD.
 */

const DEMO_PASSWORD = 'demo-password';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function random(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = random(20261001);
const int = (min, max) => min + Math.floor(rnd() * (max - min + 1));
const pick = (list) => list[Math.floor(rnd() * list.length)];
const weighted = (pairs) => {
  const total = pairs.reduce((sum, [, w]) => sum + w, 0);
  let r = rnd() * total;
  for (const [value, w] of pairs) { r -= w; if (r <= 0) return value; }
  return pairs[pairs.length - 1][0];
};

const DAY = 86400000;
const isoIn = (days) => new Date(Date.now() + days * DAY).toISOString();
// SQLite's own date format (UTC, no zone), as CURRENT_TIMESTAMP writes it
const sqlDate = (daysAgo) => new Date(Date.now() - daysAgo * DAY).toISOString().replace('T', ' ').slice(0, 19);

// ─── Visits ───────────────────────────────────────────────────────────────────

const VISITORS = Array.from({ length: 450 }, (_, i) => crypto.createHash('sha256').update(`demo-visitor-${i}`).digest('hex'));
const COUNTRIES = [['CH', 18], ['DE', 16], ['FR', 12], ['US', 20], ['GB', 9], ['NL', 6], ['CA', 5], ['JP', 4], ['BR', 4], ['IN', 4], [null, 2]];
const REFERRERS = [[null, 40], ['https://www.google.com/', 18], ['https://twitter.com/', 10], ['https://news.ycombinator.com/', 6],
  ['https://www.reddit.com/', 7], ['https://www.linkedin.com/', 8], ['https://github.com/', 6], ['https://duckduckgo.com/', 5]];
const AGENTS = [
  [['Chrome', 'Windows', 'desktop', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'], 26],
  [['Chrome', 'Android', 'mobile', 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36'], 18],
  [['Safari', 'iOS', 'mobile', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'], 20],
  [['Safari', 'macOS', 'desktop', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'], 10],
  [['Firefox', 'Linux', 'desktop', 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0'], 8],
  [['Firefox', 'Windows', 'desktop', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0'], 6],
  [['Edge', 'Windows', 'desktop', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0'], 7],
  [['Safari', 'iPadOS', 'tablet', 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'], 5]
];

const insertEvent = () => db.prepare(`
  INSERT INTO analytics_events (targetType, targetId, subTargetId, timestamp, ipHash, referrer, userAgent, browser, os, device, country)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

/**
 * `count` visits between `fromDaysAgo` and `toDaysAgo` (more of them recently), newest weeks busiest
 * @returns {number} how many were recorded
 */
function visits(type, id, count, { fromDaysAgo = 30, toDaysAgo = 0, subIds = [] } = {}) {
  const insert = insertEvent();
  for (let i = 0; i < count; i++) {
    const span = fromDaysAgo - toDaysAgo;
    const daysAgo = toDaysAgo + span * Math.pow(rnd(), 1.6);
    const [browser, os, device, agent] = weighted(AGENTS);
    const when = new Date(Date.now() - daysAgo * DAY).toISOString();
    const visitor = pick(VISITORS);
    const referrer = weighted(REFERRERS);
    const country = weighted(COUNTRIES);
    insert.run(type, id, null, when, visitor, referrer, agent, browser, os, device, country);
    // Someone who opened a bundle often clicks one of its links
    if (subIds.length && rnd() < 0.7) insert.run(type, id, pick(subIds), when, visitor, referrer, agent, browser, os, device, country);
  }
  return count;
}

// ─── Builders ─────────────────────────────────────────────────────────────────

function makeUser(passwordHash, { username, isAdmin = 0, isBanned = 0, role = null, createdDaysAgo = 30, activeDaysAgo = 1 }) {
  const result = db.prepare(`
    INSERT INTO users (username, email, password, isAdmin, isBanned, role, createdAt, lastActive)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(username, `${username}@demo.example`, passwordHash, isAdmin, isBanned, role,
    sqlDate(createdDaysAgo), activeDaysAgo === null ? null : sqlDate(activeDaysAgo));
  return User.findById(result.lastInsertRowid);
}

// Flags and dates the models don't take at creation
function finish(table, id, { createdDaysAgo = 10, blocked, quarantined, teamId } = {}) {
  db.prepare(`UPDATE ${table} SET createdAt = ? WHERE id = ?`).run(sqlDate(createdDaysAgo), id);
  if (blocked) db.prepare(`UPDATE ${table} SET isBlocked = 1 WHERE id = ?`).run(id);
  if (quarantined) db.prepare(`UPDATE ${table} SET isQuarantined = 1 WHERE id = ?`).run(id);
  if (teamId) db.prepare(`UPDATE ${table} SET teamId = ? WHERE id = ?`).run(teamId, id);
}

// ─── Seed ─────────────────────────────────────────────────────────────────────

/**
 * @param {{ passwordHash: string }} options - bcrypt hash of DEMO_PASSWORD (accounts and protected items)
 * @returns {Promise<{ accounts: Array<{ username, password, note }>, shareLink: string, counts: object }>}
 */
async function seedDemo({ passwordHash }) {
  const counts = { urls: 0, bundles: 0, pastes: 0, files: 0, visits: 0 };

  // People
  const admin = makeUser(passwordHash, { username: 'admin', isAdmin: 1, createdDaysAgo: 120, activeDaysAgo: 0 });
  const alice = makeUser(passwordHash, { username: 'alice', createdDaysAgo: 110, activeDaysAgo: 0 });
  const bob = makeUser(passwordHash, { username: 'bob', createdDaysAgo: 90, activeDaysAgo: 2 });
  const carol = makeUser(passwordHash, { username: 'carol', role: 'trusted', createdDaysAgo: 75, activeDaysAgo: 1 });
  const dave = makeUser(passwordHash, { username: 'dave', role: 'unlimited', createdDaysAgo: 60, activeDaysAgo: 4 });
  const erin = makeUser(passwordHash, { username: 'erin', isBanned: 1, createdDaysAgo: 40, activeDaysAgo: 20 });
  makeUser(passwordHash, { username: 'frank', createdDaysAgo: 2, activeDaysAgo: null }); // signed up, never came back

  // Tags with their colors (items pick them up by name)
  const TAGS = { marketing: '#f472b6', launch: '#34d399', docs: '#60a5fa', personal: '#a78bfa', video: '#fb923c', events: '#fbbf24' };
  for (const [name, color] of Object.entries(TAGS)) {
    for (const owner of [alice, bob, carol]) Tag.create(name, owner.id, color);
  }

  // Teams: Marketing (owner admin; alice admin, carol member, bob viewer), Events (owner carol; dave member)
  const accept = (user, teamId) => {
    const invite = db.prepare('SELECT id FROM team_invites WHERE teamId = ? AND userId = ?').get(teamId, user.id);
    teamService.acceptInvite(User.findById(user.id), invite.id);
  };
  const marketing = teamService.create(admin, 'Marketing');
  for (const [user, role] of [[alice, 'admin'], [carol, 'member'], [bob, 'viewer']]) {
    teamService.invite(admin, marketing.id, user.username, role);
    accept(user, marketing.id);
  }
  const events = teamService.create(carol, 'Events crew');
  teamService.invite(User.findById(carol.id), events.id, dave.username, 'member');
  accept(dave, events.id);
  teamService.invite(User.findById(carol.id), events.id, alice.username, 'member'); // left pending: alice sees it on her dashboard
  for (const team of [marketing, events]) Tag.create('campaign', null, '#2dd4bf', team.id);

  // ── Links ──
  const link = (owner, slugName, longUrl, options = {}) => {
    const url = Url.create({
      slug: slugName, longUrl, creatorId: owner ? owner.id : null,
      maxUses: options.maxUses || null, expiresAt: options.expiresAt || null,
      password: options.password ? passwordHash : null,
      activateAt: options.activateAt || null, deactivateAt: options.deactivateAt || null
    });
    finish('urls', url.id, options);
    if (options.tags) Tag.setForItem('url', url.id, options.tags);
    const n = options.visits === undefined ? int(5, 80) : options.visits;
    const recorded = n ? visits('url', url.id, n, { fromDaysAgo: Math.min(options.createdDaysAgo || 30, 30), toDaysAgo: options.visitsUntilDaysAgo || 0 }) : 0;
    db.prepare('UPDATE urls SET clicks = ? WHERE id = ?').run(recorded, url.id);
    counts.urls++; counts.visits += recorded;
    return url;
  };

  const press = link(alice, 'press', 'https://example.com/press-kit', { tags: ['marketing', 'launch'], visits: 340, createdDaysAgo: 45 });
  link(alice, 'docs', 'https://docs.example.com/getting-started', { tags: ['docs'], visits: 210, createdDaysAgo: 60 });
  link(alice, 'talk', 'https://www.youtube.com/watch?v=JSur9qyqtuA&t=262s', { tags: ['video', 'events'], visits: 125, createdDaysAgo: 20 });
  link(alice, 'repo', 'https://github.com/D3m0nZOnFire/LinkSnip', { tags: ['docs'], visits: 95, createdDaysAgo: 50 });
  link(alice, 'newsletter', 'https://newsletter.example.com/issue-42', { tags: ['marketing'], createdDaysAgo: 8 });
  link(alice, 'beta-signup', 'https://forms.example.com/beta', { maxUses: 100, visits: 87, tags: ['launch'], createdDaysAgo: 14 });
  link(alice, 'early-bird', 'https://shop.example.com/early-bird', { maxUses: 25, visits: 25, tags: ['launch'], createdDaysAgo: 18 });
  link(alice, 'summer-sale', 'https://shop.example.com/summer', { expiresAt: isoIn(-70), createdDaysAgo: 100, visits: 60, visitsUntilDaysAgo: 70, tags: ['marketing'] });
  link(alice, 'webinar', 'https://events.example.com/webinar-replay', { expiresAt: isoIn(-3), createdDaysAgo: 25, visits: 44, visitsUntilDaysAgo: 3 });
  link(alice, 'launch-day', 'https://example.com/launch', { activateAt: isoIn(3), createdDaysAgo: 1, visits: 0, tags: ['launch'] });
  link(alice, 'team-only', 'https://intranet.example.com/handbook', { password: true, createdDaysAgo: 30 });
  link(alice, 'q3-report', 'https://example.com/reports/q3.pdf', { deactivateAt: isoIn(-10), createdDaysAgo: 40, visitsUntilDaysAgo: 10 });

  link(bob, 'recipes', 'https://cooking.example.org/recipes/lasagna', { tags: ['personal'], createdDaysAgo: 35 });
  link(bob, 'trailer', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', { tags: ['video'], visits: 150, createdDaysAgo: 28 });
  link(bob, 'free-prize', 'http://free-prize.example.net/claim', { visits: 40, createdDaysAgo: 6, quarantined: true });
  link(bob, 'crypto-deal', 'http://crypto-deal.example.net/', { visits: 12, createdDaysAgo: 9, blocked: true });
  link(bob, 'playlist', 'https://music.example.com/playlist/road-trip', { tags: ['personal'], createdDaysAgo: 12 });
  link(bob, 'wishlist', 'https://shop.example.com/wishlist/bob', { password: true, createdDaysAgo: 22 });
  link(bob, 'old-blog', 'https://blog.example.org/2019/hello', { expiresAt: isoIn(-80), createdDaysAgo: 200, visits: 30, visitsUntilDaysAgo: 80 });

  link(carol, 'meetup', 'https://events.example.com/meetup-october', { tags: ['events'], visits: 180, createdDaysAgo: 26 });
  link(carol, 'venue', 'https://maps.example.com/venue', { tags: ['events'], createdDaysAgo: 26 });
  link(carol, 'speakers', 'https://events.example.com/call-for-speakers', { maxUses: 50, visits: 50, tags: ['events'], createdDaysAgo: 33 });
  link(carol, 'tickets', 'https://tickets.example.com/devday', { activateAt: isoIn(7), deactivateAt: isoIn(30), createdDaysAgo: 2, visits: 0 });
  link(carol, 'slides', 'https://slides.example.com/keynote', { password: true, createdDaysAgo: 15 });

  link(dave, 'status', 'https://status.example.com', { visits: 260, createdDaysAgo: 55 });
  link(dave, 'api', 'https://api.example.com/v2/docs', { createdDaysAgo: 48 });
  link(dave, 'changelog', 'https://example.com/changelog', { createdDaysAgo: 5 });
  link(dave, 'support', 'https://support.example.com/new-ticket', { createdDaysAgo: 31 });

  link(erin, 'win-iphone', 'http://win-an-iphone.example.net/', { visits: 66, createdDaysAgo: 30, blocked: true });
  link(erin, 'cheap-pills', 'http://pharmacy.example.net/', { visits: 21, createdDaysAgo: 29, blocked: true });

  for (const [i, target] of ['https://en.wikipedia.org/wiki/URL_shortening', 'https://example.com/a-very/long/path?with=query&and=more',
    'https://www.openstreetmap.org/#map=12/46.95/7.45', 'https://archive.org/web/', 'https://weather.example.com/bern'].entries()) {
    link(null, `anon${i + 1}`, target, { expiresAt: isoIn(20 - i * 2), createdDaysAgo: 10 + i });
  }
  link(null, 'anon-expired', 'https://example.com/old-anonymous', { expiresAt: isoIn(-2), createdDaysAgo: 32, visitsUntilDaysAgo: 2 });
  link(null, 'anon-reported', 'http://login-verify.example.net/', { createdDaysAgo: 4, quarantined: true, visits: 18 });

  link(alice, 'brand-assets', 'https://drive.example.com/brand', { teamId: marketing.id, tags: ['campaign'], createdDaysAgo: 16 });
  link(carol, 'campaign-q4', 'https://example.com/campaign/q4', { teamId: marketing.id, tags: ['campaign'], visits: 130, createdDaysAgo: 11 });
  link(admin, 'press-release', 'https://example.com/press/2026-10', { teamId: marketing.id, createdDaysAgo: 3 });
  link(carol, 'devday-agenda', 'https://events.example.com/devday/agenda', { teamId: events.id, tags: ['campaign'], createdDaysAgo: 9 });

  for (let i = 1; i <= 10; i++) link(pick([alice, bob, carol, dave]), `go${i}`, `https://example.com/landing/${i}`, { createdDaysAgo: int(1, 50) });

  // ── Bundles ──
  const bundle = (owner, slugName, title, urls, options = {}) => {
    const b = Bundle.create({
      slug: slugName, title, description: options.description || null, creatorId: owner ? owner.id : null,
      maxUses: options.maxUses || null, expiresAt: options.expiresAt || null,
      password: options.password ? passwordHash : null, activateAt: options.activateAt || null, deactivateAt: null
    });
    Bundle.replaceItems(b.id, urls.map(([url, label]) => ({ url, label })));
    finish('bundles', b.id, options);
    if (options.tags) Tag.setForItem('bundle', b.id, options.tags);
    const itemIds = db.prepare('SELECT id FROM bundle_items WHERE bundleId = ?').all(b.id).map(r => r.id);
    const n = options.visits === undefined ? int(10, 60) : options.visits;
    const recorded = n ? visits('bundle', b.id, n, { fromDaysAgo: Math.min(options.createdDaysAgo || 30, 30), subIds: itemIds }) : 0;
    db.prepare('UPDATE bundles SET clicks = ? WHERE id = ?').run(recorded, b.id);
    counts.bundles++; counts.visits += recorded;
    return b;
  };

  bundle(alice, 'launch-kit', 'Launch kit', [['https://example.com/press-kit', 'Press kit'], ['https://example.com/logos.zip', 'Logos'],
    ['https://docs.example.com/getting-started', 'Docs'], ['https://www.youtube.com/watch?v=JSur9qyqtuA', 'Demo video']],
  { description: 'Everything for the launch in one link', tags: ['launch'], visits: 120, createdDaysAgo: 21 });
  bundle(alice, 'reading', 'Weekend reading', [['https://example.org/essay-1', 'On simplicity'], ['https://example.org/essay-2', 'Small tools']],
    { createdDaysAgo: 7 });
  bundle(bob, 'family', 'Family links', [['https://photos.example.com/summer', 'Photos'], ['https://calendar.example.com/family', 'Calendar']],
    { password: true, createdDaysAgo: 40 });
  bundle(carol, 'devday', 'DevDay 2026', [['https://events.example.com/devday', 'Site'], ['https://tickets.example.com/devday', 'Tickets']],
    { activateAt: isoIn(5), visits: 0, createdDaysAgo: 2 });
  bundle(dave, 'onboarding', 'New hire onboarding', [['https://intranet.example.com/welcome', 'Welcome'], ['https://intranet.example.com/it', 'IT setup'],
    ['https://intranet.example.com/benefits', 'Benefits']], { maxUses: 30, visits: 30, createdDaysAgo: 45 });
  bundle(carol, 'q4-assets', 'Q4 campaign assets', [['https://drive.example.com/q4', 'Drive'], ['https://figma.example.com/q4', 'Designs']],
    { teamId: marketing.id, tags: ['campaign'], createdDaysAgo: 10 });
  bundle(null, 'anon-bundle', 'Some links', [['https://example.com/x', 'X'], ['https://example.com/y', 'Y']],
    { expiresAt: isoIn(12), createdDaysAgo: 3, visits: 9 });

  // ── Pastes ──
  const paste = (owner, slugName, title, content, options = {}) => {
    const p = Paste.create({
      userId: owner ? owner.id : null, slug: slugName, title, content, language: options.language || 'text',
      expiresAt: options.expiresAt || null, activateAt: options.activateAt || null, deactivateAt: null,
      maxViews: options.maxViews || null, password: options.password ? passwordHash : null
    });
    finish('pastes', p.id, options);
    if (options.tags) Tag.setForItem('paste', p.id, options.tags);
    const n = options.visits === undefined ? int(2, 40) : options.visits;
    const recorded = n ? visits('paste', p.id, n, { fromDaysAgo: Math.min(options.createdDaysAgo || 30, 30), toDaysAgo: options.visitsUntilDaysAgo || 0 }) : 0;
    db.prepare('UPDATE pastes SET views = ? WHERE id = ?').run(recorded, p.id);
    counts.pastes++; counts.visits += recorded;
    return p;
  };

  paste(alice, 'deploy', 'Deploy checklist', '1. Run the tests\n2. Tag the release (vX.Y.Z)\n3. Watch the deploy\n4. Check /healthz\n5. Announce it', { language: 'markdown', tags: ['docs'], createdDaysAgo: 30 });
  paste(alice, 'nginx', 'nginx proxy snippet', 'location / {\n  proxy_pass http://127.0.0.1:8081;\n  proxy_set_header Host $host;\n  proxy_set_header X-Forwarded-Proto $scheme;\n}', { language: 'nginx', tags: ['docs'], createdDaysAgo: 41 });
  paste(alice, 'press-quote', 'Press quote', '"LinkSnip made our launch links trackable in an afternoon." — A happy team', { createdDaysAgo: 14, tags: ['marketing'] });
  paste(alice, 'retro', 'Sprint retro notes', 'Went well: shipping\nTo improve: fewer meetings', { expiresAt: isoIn(-65), createdDaysAgo: 90, visitsUntilDaysAgo: 65 });
  paste(bob, 'script', 'backup.sh', '#!/bin/sh\nset -e\nsqlite3 data/database.db ".backup backup.db"\necho done', { language: 'bash', createdDaysAgo: 19 });
  paste(bob, 'spam-paste', 'FREE MONEY', 'Click http://free-prize.example.net for free money!!!', { createdDaysAgo: 5, blocked: true, visits: 3 });
  paste(bob, 'secret-notes', 'Private notes', 'Only for people with the password.', { password: true, createdDaysAgo: 11 });
  paste(carol, 'agenda', 'Meetup agenda', '18:00 Doors\n18:30 Talks\n20:00 Drinks', { language: 'markdown', tags: ['events'], createdDaysAgo: 24 });
  paste(carol, 'one-time', 'One-time code', 'XK7-P2Q-9LM', { maxViews: 1, visits: 1, createdDaysAgo: 6 });
  paste(dave, 'config', 'docker-compose.yml', 'services:\n  linksnip:\n    image: ghcr.io/d3m0nzonfire/linksnip\n    ports: ["127.0.0.1:8081:8081"]\n    volumes: ["./data:/data"]', { language: 'yaml', createdDaysAgo: 37 });
  paste(dave, 'release-notes', 'Release notes draft', 'v1.3.0: a new look, palettes, admin mode.', { activateAt: isoIn(4), visits: 0, createdDaysAgo: 1 });
  paste(null, 'anon-paste', 'Shared snippet', 'console.log("hello from an anonymous paste");', { language: 'javascript', expiresAt: isoIn(15), createdDaysAgo: 3 });
  paste(carol, 'brief', 'Campaign brief', 'Audience: developers. Message: links you can trust.', { teamId: marketing.id, tags: ['campaign'], createdDaysAgo: 12 });

  // ── Files (stored for real in DATA_DIR/uploads) ──
  fs.mkdirSync(paths.UPLOADS_DIR, { recursive: true });
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkqPv/HwAFhgKhJt6kNAAAAABJRU5ErkJggg==', 'base64');
  const file = (owner, slugName, originalName, mimeType, content, options = {}) => {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const storedName = `${crypto.createHash('sha256').update(slugName).digest('hex').slice(0, 24)}${path.extname(originalName)}`;
    fs.writeFileSync(path.join(paths.UPLOADS_DIR, storedName), data);
    const f = File.create({
      userId: owner.id, slug: slugName, originalName, storedName, mimeType, size: data.length,
      expiresAt: options.expiresAt || null, activateAt: null, deactivateAt: null, maxDownloads: options.maxDownloads || null,
      password: options.password ? passwordHash : null, sharingMode: options.allowedUsers ? 'restricted' : 'public',
      allowedUsers: (options.allowedUsers || []).map(u => u.id)
    });
    finish('files', f.id, options);
    if (options.tags) Tag.setForItem('file', f.id, options.tags);
    const n = options.visits === undefined ? int(1, 25) : options.visits;
    const recorded = n ? visits('file', f.id, n, { fromDaysAgo: Math.min(options.createdDaysAgo || 30, 30) }) : 0;
    db.prepare('UPDATE files SET downloads = ? WHERE id = ?').run(recorded, f.id);
    counts.files++; counts.visits += recorded;
    return f;
  };

  file(alice, 'logo', 'logo.svg', 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#34d399"/></svg>', { tags: ['marketing'], createdDaysAgo: 44 });
  file(alice, 'pixel', 'pixel.png', 'image/png', PNG, { createdDaysAgo: 30 });
  file(alice, 'pricing', 'pricing.csv', 'text/csv', 'plan,price\nfree,0\npro,9\nteam,29\n', { tags: ['launch'], createdDaysAgo: 17 });
  file(bob, 'family-tree', 'family-tree.json', 'application/json', JSON.stringify({ name: 'Bob', children: [] }, null, 2), { allowedUsers: [alice], createdDaysAgo: 26 });
  file(bob, 'invoice', 'invoice-0042.txt', 'text/plain', 'Invoice 0042\nTotal: 120 CHF\n', { password: true, createdDaysAgo: 8 });
  file(carol, 'badge', 'speaker-badge.txt', 'text/plain', 'SPEAKER\nCarol\nDevDay 2026\n', { maxDownloads: 5, visits: 5, createdDaysAgo: 13 });
  file(dave, 'old-export', 'export-2025.csv', 'text/csv', 'slug,clicks\nstatus,260\n', { expiresAt: isoIn(-5), createdDaysAgo: 70 });
  file(dave, 'malware', 'totally-safe.txt', 'text/plain', 'Not actually malware, just a reported demo file.', { quarantined: true, createdDaysAgo: 6 });
  file(carol, 'brand-guide', 'brand-guide.txt', 'text/plain', 'Colors, logo use, tone of voice.', { teamId: marketing.id, tags: ['campaign'], createdDaysAgo: 15 });

  // ── Reports ──
  const REPORTERS = Array.from({ length: 40 }, (_, i) => crypto.createHash('sha256').update(`demo-reporter-${i}`).digest('hex'));
  let reporter = 0;
  const report = (type, slugName, reason, description, { status = 'pending', daysAgo = 2 } = {}) => {
    const { table } = contentType(type);
    const item = db.prepare(`SELECT id FROM ${table} WHERE slug = ?`).get(slugName);
    db.prepare(`
      INSERT INTO reports (targetType, targetId, reporterIpHash, reason, description, status, reviewedBy, reviewedAt, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(type, item.id, REPORTERS[reporter++], reason, description, status,
      status === 'pending' ? null : admin.id, status === 'pending' ? null : sqlDate(daysAgo - 1), sqlDate(daysAgo));
  };
  for (const [reason, text] of [['FRAUD', 'Says I won a prize'], ['PHISHING', 'Asks for my bank login'], ['SPAM', 'Got this in five group chats']]) {
    report('url', 'free-prize', reason, text, { daysAgo: int(1, 4) });
  }
  for (const reason of ['PHISHING', 'FRAUD', 'PHISHING', 'OTHER']) report('url', 'anon-reported', reason, 'Fake login page', { daysAgo: int(1, 3) });
  for (const reason of ['MALWARE', 'MALWARE', 'OTHER']) report('file', 'malware', reason, 'File name looks suspicious', { daysAgo: 2 });
  report('paste', 'spam-paste', 'SPAM', 'Spam link', { status: 'blocked', daysAgo: 4 });
  report('url', 'crypto-deal', 'FRAUD', 'Crypto scam', { status: 'blocked', daysAgo: 8 });
  report('url', 'trailer', 'COPYRIGHT', 'Not their video', { status: 'dismissed', daysAgo: 10 });
  report('url', 'press', 'OTHER', 'Clicked by mistake', { status: 'dismissed', daysAgo: 12 });
  report('url', 'recipes', 'SPAM', 'Too many recipes', { daysAgo: 1 });
  report('bundle', 'reading', 'OTHER', 'One link is broken', { daysAgo: 3 });

  // ── Share links, bio page ──
  const { token } = AnalyticsShare.create({ targetType: 'url', targetId: press.id, createdBy: alice.id, label: 'Press team' });
  AnalyticsShare.create({ targetType: 'bundle', targetId: db.prepare("SELECT id FROM bundles WHERE slug = 'launch-kit'").get().id, createdBy: alice.id, label: 'Agency', expiresAt: isoIn(30) });

  const bio = BioPage.create(alice.id, 'Alice Martin', 'Product designer. Writing about small, sharp tools.', 'dark');
  BioPage.update(bio.id, {
    displayName: 'Alice Martin', bio: 'Product designer. Writing about small, sharp tools.', theme: 'dark',
    socialLinks: [{ platform: 'GitHub', url: 'https://github.com/', icon: 'github' }, { platform: 'Mastodon', url: 'https://mastodon.social/', icon: 'mastodon' }]
  });
  for (const [i, s] of ['press', 'docs', 'talk', 'repo'].entries()) {
    BioPage.attachUrl(bio.id, db.prepare('SELECT id FROM urls WHERE slug = ?').get(s).id, i);
  }

  // ── Audit history ──
  const log = (daysAgo, user, action, category, target = {}) => {
    const entry = AuditLog.create({
      userId: user ? user.id : null, username: user ? user.username : null, action, category,
      targetType: target.type, targetId: target.id, targetDescription: target.description,
      ipAddress: `203.0.113.${int(2, 250)}`, userAgent: pick(AGENTS)[0][3], details: target.details ? JSON.stringify(target.details) : null
    });
    db.prepare('UPDATE audit_logs SET createdAt = ? WHERE id = ?').run(sqlDate(daysAgo), entry.id);
  };
  for (let day = 30; day >= 0; day -= 1) {
    for (const user of [admin, alice, bob, carol, dave]) if (rnd() < 0.35) log(day + rnd() * 0.9, user, 'LOGIN_SUCCESS', 'AUTH');
  }
  for (let i = 0; i < 6; i++) log(int(1, 25), null, 'LOGIN_FAILED', 'AUTH', { details: { username: pick(['admin', 'root', 'test']) } });
  log(40, admin, 'SETUP_ADMIN', 'ADMIN_ACTION', { type: 'user', id: admin.id, description: 'admin' });
  log(20, admin, 'BAN_USER', 'ADMIN_ACTION', { type: 'user', id: erin.id, description: 'erin' });
  log(8, admin, 'BLOCK_URL', 'ADMIN_ACTION', { type: 'url', description: '/s/crypto-deal → http://crypto-deal.example.net/' });
  log(4, admin, 'BLOCK_PASTE', 'ADMIN_ACTION', { type: 'paste', description: '/p/spam-paste' });
  log(30, admin, 'CREATE_TEAM', 'ACCOUNT_CHANGE', { type: 'team', id: marketing.id, description: 'Marketing' });
  log(25, carol, 'CREATE_TEAM', 'ACCOUNT_CHANGE', { type: 'team', id: events.id, description: 'Events crew' });
  log(6, admin, 'UPDATE_SETTINGS', 'ADMIN_ACTION', { type: 'settings', description: 'settings.json', details: { 'moderation.reportThreshold': { from: 5, to: 3 } } });
  log(3, null, 'QUARANTINE_URL', 'SECURITY', { type: 'url', description: '/s/free-prize' });
  log(2, alice, 'CREATE_SHARE_LINK', 'ACCOUNT_CHANGE', { type: 'url', id: press.id, description: 'Press team' });

  return {
    accounts: [
      { username: 'admin', password: DEMO_PASSWORD, note: 'admin: every page, admin mode' },
      { username: 'alice', password: DEMO_PASSWORD, note: 'default role, lots of content, bio page, Marketing team admin, a pending invite' },
      { username: 'bob', password: DEMO_PASSWORD, note: 'default role, reported and blocked items, Marketing team viewer' },
      { username: 'carol', password: DEMO_PASSWORD, note: 'trusted role, owns the Events crew team' },
      { username: 'dave', password: DEMO_PASSWORD, note: 'unlimited role' },
      { username: 'erin', password: DEMO_PASSWORD, note: 'banned (can\'t log in)' },
      { username: 'frank', password: DEMO_PASSWORD, note: 'new account, nothing yet' }
    ],
    shareLink: `/stats/${token}`,
    counts
  };
}

module.exports = { seedDemo, DEMO_PASSWORD };
