// Zone-less dates are stored as UTC ("no timezone conversion"). Run in a zone away
// from UTC (Zurich is UTC+2 in June) so a check that parses them as local time
// gives the wrong answer for the "just ahead" cases below.
process.env.TZ = 'Europe/Zurich';

const access = require('../../../services/accessService');
const { sendNotFound } = require('../../../middleware/notFound');
const { getTestDatabase } = require('../../setup/testDatabase');
const {
  createTestUrl, createTestBundle, createTestPaste, createTestFile,
  createMockRequest, createMockResponse
} = require('../../setup/testHelpers');

const NOW = new Date('2026-06-15T12:00:00.000Z');
const PAST = '2026-06-14T12:00:00.000Z';
const FUTURE = '2026-06-16T12:00:00.000Z';

// Per type: the table, and the columns behind "used" / "limit"
const TYPES = {
  url:    { table: 'urls',    used: 'clicks',    limit: 'maxUses',      quarantine: true },
  bundle: { table: 'bundles', used: 'clicks',    limit: 'maxUses',      quarantine: true },
  paste:  { table: 'pastes',  used: 'views',     limit: 'maxViews',     quarantine: true },
  file:   { table: 'files',   used: 'downloads', limit: 'maxDownloads', quarantine: true }
};

let slugCounter = 0;

/** Insert a record of `type`; `used` / `limit` map to that type's own columns. */
function insert(type, fields = {}) {
  const { used, limit, ...rest } = fields;
  const cols = { ...rest, slug: `s${++slugCounter}` };
  if (used !== undefined) cols[TYPES[type].used] = used;
  if (limit !== undefined) cols[TYPES[type].limit] = limit;
  if (type === 'url') return createTestUrl(cols);
  if (type === 'bundle') return createTestBundle(cols);
  if (type === 'paste') return createTestPaste(null, cols);
  return createTestFile(fileOwnerId(), cols);
}

function fileOwnerId() {
  const db = getTestDatabase();
  const row = db.prepare("SELECT id FROM users WHERE username = 'fileowner'").get();
  if (row) return row.id;
  return db.prepare("INSERT INTO users (username, password) VALUES ('fileowner', 'x')").run().lastInsertRowid;
}

function sqlStatus(type, id) {
  const { sql, params } = access.statusSql(type, { alias: 't', now: NOW.toISOString() });
  return getTestDatabase()
    .prepare(`SELECT ${sql} AS status FROM ${TYPES[type].table} t WHERE t.id = ?`)
    .get(...params, id).status;
}

// Statuses that depend on the record alone (the ones the SQL can compute)
const RECORD_CASES = [
  ['nothing set', {}, 'active'],
  ['blocked', { isBlocked: 1 }, 'blocked'],
  ['blocked and expired', { isBlocked: 1, expiresAt: PAST }, 'blocked'],
  ['blocked and scheduled', { isBlocked: 1, activateAt: FUTURE }, 'blocked'],
  ['blocked and limit reached', { isBlocked: 1, used: 5, limit: 5 }, 'blocked'],
  ['scheduled and limit reached', { activateAt: FUTURE, used: 5, limit: 5 }, 'scheduled'],
  ['activateAt in the future', { activateAt: FUTURE }, 'scheduled'],
  ['activateAt exactly now', { activateAt: NOW.toISOString() }, 'active'],
  ['activateAt in the past', { activateAt: PAST }, 'active'],
  ['scheduled and already expired', { activateAt: FUTURE, expiresAt: PAST }, 'scheduled'],
  ['expiresAt in the past', { expiresAt: PAST }, 'expired'],
  ['expiresAt exactly now', { expiresAt: NOW.toISOString() }, 'active'],
  ['expiresAt in the future', { expiresAt: FUTURE }, 'active'],
  ['deactivateAt in the past', { deactivateAt: PAST }, 'expired'],
  ['deactivateAt in the future', { deactivateAt: FUTURE }, 'active'],
  ['limit reached', { used: 5, limit: 5 }, 'limit_reached'],
  ['limit passed', { used: 6, limit: 5 }, 'limit_reached'],
  ['under the limit', { used: 4, limit: 5 }, 'active'],
  ['a limit of 0', { used: 0, limit: 0 }, 'limit_reached'],
  ['expired and limit reached', { expiresAt: PAST, used: 5, limit: 5 }, 'expired'],
  // Date formats the code writes: toISOString(), parseScheduleDate() and raw datetime-local
  ['datetime-local expiresAt just passed', { expiresAt: '2026-06-15T11:59' }, 'expired'],
  ['datetime-local expiresAt just ahead', { expiresAt: '2026-06-15T12:01' }, 'active'],
  ['datetime-local activateAt just passed', { activateAt: '2026-06-15T11:59' }, 'active'],
  ['datetime-local activateAt just ahead', { activateAt: '2026-06-15T12:01' }, 'scheduled'],
  ['SQLite-style expiresAt just passed', { expiresAt: '2026-06-15 11:59:00' }, 'expired'],
  ['SQLite-style deactivateAt just ahead', { deactivateAt: '2026-06-15 12:01:00' }, 'active']
];

const QUARANTINE_CASES = [
  ['quarantined', { isQuarantined: 1 }, 'quarantined'],
  ['quarantined and blocked', { isQuarantined: 1, isBlocked: 1 }, 'blocked'],
  ['quarantined and expired', { isQuarantined: 1, expiresAt: PAST }, 'expired'],
  ['quarantined and limit reached', { isQuarantined: 1, used: 1, limit: 1 }, 'limit_reached'],
  ['quarantined and scheduled', { isQuarantined: 1, activateAt: FUTURE }, 'scheduled']
];

describe('accessService', () => {
  describe.each(Object.keys(TYPES))('%s: record statuses', (type) => {
    const cases = TYPES[type].quarantine ? [...RECORD_CASES, ...QUARANTINE_CASES] : RECORD_CASES;

    it.each(cases)('%s → %s in JS and SQL alike', (_name, fields, expected) => {
      const inserted = insert(type, fields);
      const record = getTestDatabase().prepare(`SELECT * FROM ${TYPES[type].table} WHERE id = ?`).get(inserted.id);

      expect(access.evaluate(type, record, { now: NOW }).status).toBe(expected);
      expect(access.recordStatus(type, record, NOW)).toBe(expected);
      expect(sqlStatus(type, inserted.id)).toBe(expected);
    });
  });

  describe('recordStatus', () => {
    it('ignores the password, privacy and the visitor, like the SQL', () => {
      const file = { id: 1, userId: 2, isBlocked: 0, downloads: 0, maxDownloads: null, password: 'hash', isPrivate: 1 };
      expect(access.recordStatus('file', file, NOW)).toBe('active');
    });
  });

  describe('evaluate: statuses that depend on the visitor', () => {
    const url = (fields) => ({ id: 1, slug: 'x', isBlocked: 0, isQuarantined: 0, clicks: 0, maxUses: null, ...fields });

    it('marks an allowed record', () => {
      expect(access.evaluate('url', url(), { now: NOW })).toEqual({ status: 'active', allowed: true });
      expect(access.evaluate('url', url({ isBlocked: 1 }), { now: NOW })).toEqual({ status: 'blocked', allowed: false });
    });

    it('asks for the password until the record is unlocked', () => {
      expect(access.evaluate('url', url({ password: 'hash' }), { now: NOW }).status).toBe('password_required');
      expect(access.evaluate('url', url({ password: 'hash' }), { now: NOW, unlocked: true }).status).toBe('active');
    });

    it('shows the quarantine warning before the password prompt', () => {
      const record = url({ isQuarantined: 1, password: 'hash' });
      expect(access.evaluate('url', record, { now: NOW }).status).toBe('quarantined');
      expect(access.evaluate('url', record, { now: NOW, quarantineAck: true }).status).toBe('password_required');
      expect(access.evaluate('url', record, { now: NOW, quarantineAck: true, unlocked: true }).status).toBe('active');
    });

    it('lets a visitor through a quarantine they acknowledged', () => {
      expect(access.evaluate('bundle', url({ isQuarantined: 1 }), { now: NOW, quarantineAck: true }).status).toBe('active');
    });

    it('checks the hard statuses before the password', () => {
      expect(access.evaluate('url', url({ password: 'hash', expiresAt: PAST }), { now: NOW }).status).toBe('expired');
    });

    it('uses the current time when no time is given', () => {
      expect(access.evaluate('url', url({ expiresAt: '2000-01-01T00:00:00.000Z' })).status).toBe('expired');
      expect(access.evaluate('url', url({ activateAt: '2999-01-01T00:00:00.000Z' })).status).toBe('scheduled');
    });
  });

  describe('evaluate: private items', () => {
    const OWNER = 10;
    const OWNER_COLUMN = { url: 'creatorId', bundle: 'creatorId', paste: 'userId', file: 'userId' };
    const record = (type, fields) => ({
      id: 1, slug: 'doc', [OWNER_COLUMN[type]]: OWNER, isBlocked: 0, isQuarantined: 0, isPrivate: 1, password: null, ...fields
    });
    const status = (type, rec, user, extra = {}) => access.evaluate(type, rec, { now: NOW, user, ...extra }).status;
    const TYPE_NAMES = ['url', 'bundle', 'paste', 'file'];

    it.each(TYPE_NAMES)('%s: sends visitors who are not logged in to the login page', (type) => {
      expect(status(type, record(type), null)).toBe('login_required');
    });

    it.each(TYPE_NAMES)('%s: a logged-in stranger finds nothing', (type) => {
      expect(status(type, record(type), { id: 99, isAdmin: 0 })).toBe('not_found');
    });

    it.each(TYPE_NAMES)('%s: lets in the owner and admins', (type) => {
      expect(status(type, record(type), { id: OWNER, isAdmin: 0 })).toBe('active');
      expect(status(type, record(type), { id: 99, isAdmin: 1 })).toBe('active');
    });

    it('hides every other status from strangers: they never learn the item exists', () => {
      expect(status('url', record('url', { isBlocked: 1 }), { id: 99 })).toBe('not_found');
      expect(status('url', record('url', { expiresAt: PAST }), null)).toBe('login_required');
      expect(status('url', record('url', { activateAt: FUTURE }), { id: 99 })).toBe('not_found');
      expect(status('url', record('url', { isQuarantined: 1 }), { id: 99 })).toBe('not_found');
    });

    it('shows the owner the other statuses as usual', () => {
      expect(status('url', record('url', { isBlocked: 1 }), { id: OWNER })).toBe('blocked');
      expect(status('url', record('url', { expiresAt: PAST }), { id: OWNER })).toBe('expired');
      expect(status('url', record('url', { isQuarantined: 1 }), { id: OWNER })).toBe('quarantined');
    });

    it('still asks the owner for the password', () => {
      expect(status('paste', record('paste', { password: 'hash' }), { id: OWNER })).toBe('password_required');
      expect(status('paste', record('paste', { password: 'hash' }), { id: OWNER }, { unlocked: true })).toBe('active');
      expect(status('paste', record('paste', { password: 'hash' }), { id: 99 })).toBe('not_found');
    });

    it('an item without an owner is private to admins', () => {
      expect(status('url', record('url', { creatorId: null }), { id: 99 })).toBe('not_found');
      expect(status('url', record('url', { creatorId: null }), { id: 99, isAdmin: 1 })).toBe('active');
    });

    it('ignores everything for public items', () => {
      expect(status('file', record('file', { isPrivate: 0 }), null)).toBe('active');
    });
  });

  describe('isLive', () => {
    it('is false only for statuses where the record itself is unavailable', () => {
      for (const s of ['blocked', 'scheduled', 'expired', 'limit_reached']) expect(access.isLive(s)).toBe(false);
      for (const s of ['active', 'quarantined', 'password_required', 'login_required']) expect(access.isLive(s)).toBe(true);
    });
  });

  describe('message', () => {
    it('names the content type', () => {
      expect(access.message('url', 'expired')).toBe('This link has expired.');
      expect(access.message('paste', 'expired')).toBe('This paste has expired.');
      expect(access.message('file', 'expired')).toBe('This file has expired.');
      expect(access.message('bundle', 'blocked')).toBe('This bundle has been blocked.');
    });

    it('has a message for every status that shows an error page', () => {
      for (const s of ['blocked', 'scheduled', 'expired', 'limit_reached']) {
        expect(access.message('paste', s)).toMatch(/^This paste|this paste/);
      }
    });
  });

  describe('checkAccess (reads the request and session)', () => {
    const visit = (session = {}, query = {}, user = null) =>
      createMockRequest({ session, query, user, get: () => undefined });

    it('remembers "Continue anyway" on a quarantined record', () => {
      const url = insert('url', { isQuarantined: 1 });
      const req = visit({}, { confirmed: '1' });

      expect(access.checkAccess(req, 'url', url).status).toBe('active');
      expect(req.session.quarantineAck).toEqual([`url:${url.id}`]);

      expect(access.checkAccess(visit(req.session), 'url', url).status).toBe('active');
    });

    it('keeps acknowledgments per type', () => {
      const bundle = insert('bundle', { isQuarantined: 1 });
      expect(access.checkAccess(visit({ quarantineAck: [`url:${bundle.id}`] }), 'bundle', bundle).status).toBe('quarantined');
    });

    it('does not record an acknowledgment for a record that is not quarantined', () => {
      const url = insert('url');
      const req = visit({}, { confirmed: '1' });
      access.checkAccess(req, 'url', url);
      expect(req.session.quarantineAck).toBeUndefined();
    });

    it.each(['url', 'bundle', 'paste', 'file'])('%s: a remembered unlock lasts, a one-time unlock is used up', (type) => {
      const record = insert(type, { password: 'hash' });

      expect(access.checkAccess(visit(), type, record).status).toBe('password_required');
      expect(access.checkAccess(visit({ unlocked: { [type]: [record.id] } }), type, record).status).toBe('active');

      const session = { unlockOnce: { type, id: record.id } };
      expect(access.checkAccess(visit(session), type, record).status).toBe('active');
      expect(session.unlockOnce).toBeUndefined();
      expect(access.checkAccess(visit(session), type, record).status).toBe('password_required');
    });

    it('keepOnce lets a one-time unlock through without using it up', () => {
      const file = insert('file', { password: 'hash' });
      const session = { unlockOnce: { type: 'file', id: file.id } };

      expect(access.checkAccess(visit(session), 'file', file, { keepOnce: true }).status).toBe('active');
      expect(session.unlockOnce).toEqual({ type: 'file', id: file.id });
      expect(access.checkAccess(visit(session), 'file', file).status).toBe('active');
      expect(session.unlockOnce).toBeUndefined();
    });

    it('an unlock of one type does not open the same ID of another type', () => {
      const url = insert('url', { password: 'hash' });
      const paste = insert('paste', { password: 'hash' });
      const session = { unlocked: { url: [paste.id] }, unlockOnce: { type: 'url', id: paste.id } };
      expect(paste.id).toBe(url.id); // same ID, different type
      expect(access.checkAccess(visit(session), 'paste', paste).status).toBe('password_required');
      expect(session.unlockOnce).toEqual({ type: 'url', id: paste.id });
    });

    it('does not use up a one-time unlock while the quarantine warning is shown', () => {
      const url = insert('url', { isQuarantined: 1, password: 'hash' });
      const session = { unlockOnce: { type: 'url', id: url.id } };

      expect(access.checkAccess(visit(session), 'url', url).status).toBe('quarantined');
      expect(session.unlockOnce).toEqual({ type: 'url', id: url.id });
    });

    it.each(['url', 'bundle', 'paste', 'file'])('%s: passes the logged-in user on for private items', (type) => {
      const record = insert(type, { isPrivate: 1 });
      expect(access.checkAccess(visit(), type, record).status).toBe('login_required');
      expect(access.checkAccess(visit({}, {}, { id: 555, isAdmin: 0 }), type, record).status).toBe('not_found');
      expect(access.checkAccess(visit({}, {}, { id: 555, isAdmin: 1 }), type, record).status).toBe('active');
    });
  });

  describe('sendIfUnavailable (unlock pages)', () => {
    const run = (record, user) => {
      const res = createMockResponse();
      const req = createMockRequest({ user, get: () => undefined, originalUrl: `/unlock/paste/${record.slug}` });
      return { sent: access.sendIfUnavailable(req, res, 'paste', record), res };
    };

    it('never shows the password page of a private item to someone who may not open it', () => {
      const paste = insert('paste', { isPrivate: 1, password: 'hash' });
      const stranger = run(paste, { id: 555, isAdmin: 0 });
      expect(stranger.sent).toBe(true);
      expect(stranger.res.statusCode).toBe(404);
      const visitor = run(paste, null);
      expect(visitor.sent).toBe(true);
      expect(visitor.res.redirect).toHaveBeenCalledWith(`/login?next=${encodeURIComponent(`/unlock/paste/${paste.slug}`)}`);
      expect(run(paste, { id: 555, isAdmin: 1 }).sent).toBe(false);
    });
  });

  describe('sendAccessDenied (one response per status)', () => {
    const send = (type, record, status, reqFields = {}) => {
      const res = createMockResponse();
      const req = createMockRequest({ get: () => undefined, originalUrl: `/x/${record.slug}`, ...reqFields });
      access.sendAccessDenied(req, res, type, record, { status, allowed: false });
      return res;
    };
    const rec = { id: 3, slug: 'abc', title: 'My bundle', longUrl: 'https://dest.example', activateAt: FUTURE };

    it('blocked → 403 error page', () => {
      const res = send('paste', rec, 'blocked');
      expect(res.statusCode).toBe(403);
      expect(res._view).toBe('error');
      expect(res._viewData).toEqual(expect.objectContaining({ code: 403, message: 'This paste has been blocked.' }));
    });

    it('scheduled → 404 scheduled page with the activation time', () => {
      const res = send('file', rec, 'scheduled');
      expect(res.statusCode).toBe(404);
      expect(res._view).toBe('scheduled');
      expect(res._viewData).toEqual(expect.objectContaining({ activateAt: FUTURE, message: access.message('file', 'scheduled') }));
    });

    it.each(['expired', 'limit_reached'])('%s → 410 error page', (status) => {
      const res = send('url', rec, status);
      expect(res.statusCode).toBe(410);
      expect(res._view).toBe('error');
      expect(res._viewData).toEqual(expect.objectContaining({ code: 410, message: access.message('url', status) }));
    });

    it('not_found → the same 404 page as an address that does not exist', () => {
      const res = send('file', rec, 'not_found');
      const unknown = createMockResponse();
      sendNotFound(createMockRequest(), unknown);
      expect(res.statusCode).toBe(404);
      expect(res._view).toBe(unknown._view);
      expect(res._viewData).toEqual(unknown._viewData);
    });

    it('login_required → login page that comes back here', () => {
      const res = send('file', rec, 'login_required', { originalUrl: '/f/abc/download' });
      expect(res.redirect).toHaveBeenCalledWith(`/login?next=${encodeURIComponent('/f/abc/download')}`);
    });

    it.each([
      ['url', '/unlock/url/abc'],
      ['paste', '/unlock/paste/abc'],
      ['file', '/unlock/file/abc'],
      ['bundle', '/unlock/bundle/abc']
    ])('%s password_required → %s', (type, target) => {
      expect(send(type, rec, 'password_required').redirect).toHaveBeenCalledWith(target);
    });

    it.each([
      ['url', '/s/abc?confirmed=1', 'https://dest.example'],
      ['bundle', '/b/abc?confirmed=1', 'My bundle']
    ])('%s quarantined → warning page', (type, continueUrl, destination) => {
      const res = send(type, rec, 'quarantined');
      expect(res._view).toBe('quarantine');
      expect(res._viewData).toEqual(expect.objectContaining({ continueUrl, destination }));
    });
  });
});
