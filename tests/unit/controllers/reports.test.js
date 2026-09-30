const fs = require('fs');
const express = require('express');
const request = require('supertest');
const paths = require('../../../config/paths');
const configService = require('../../../services/configService');
const moderation = require('../../../services/moderationService');
const ReportController = require('../../../controllers/reportController');
const InfoController = require('../../../controllers/infoController');
const Report = require('../../../models/Report');
const ipHash = require('../../../services/ipHash');
const Url = require('../../../models/Url');
const { getTestDatabase } = require('../../setup/testDatabase');
const {
  createTestUser, createTestUrl, createTestBundle, createTestPaste, createTestFile,
  createMockRequest, createMockResponse
} = require('../../setup/testHelpers');

const db = () => getTestDatabase();
const PAST = '2000-01-01T00:00:00.000Z';
const TABLES = { url: 'urls', bundle: 'bundles', paste: 'pastes', file: 'files' };
const flags = (type, id) => db().prepare(`SELECT isBlocked, isQuarantined FROM ${TABLES[type]} WHERE id = ?`).get(id);
const statuses = (type, id) =>
  db().prepare('SELECT status FROM reports WHERE targetType = ? AND targetId = ? ORDER BY id').all(type, id).map(r => r.status);
const auditActions = () => db().prepare('SELECT action FROM audit_logs ORDER BY id').all().map(r => r.action);

function setSettings(data) {
  fs.writeFileSync(paths.SETTINGS_PATH, JSON.stringify(data));
  configService.reload();
}
afterEach(() => {
  fs.rmSync(paths.SETTINGS_PATH, { force: true });
  configService.reload();
});

function submit(body, ip = '203.0.113.1', user = null) {
  const res = createMockResponse();
  ReportController.submit(createMockRequest({ body, ip, user, get: () => undefined }), res);
  return res;
}
const reportFrom = (type, id, count, start = 1) => {
  let res;
  for (let i = start; i < start + count; i++) res = submit({ type, id, reason: 'SPAM' }, `203.0.113.${i}`);
  return res;
};

let owner;
beforeEach(async () => {
  const row = await createTestUser({ username: 'owner' });
  owner = { id: row.id, username: 'owner', isAdmin: 0 };
});

// One live item per type, owned by `owner`
const MAKE = {
  url: (f = {}) => createTestUrl({ slug: 'it', creatorId: owner.id, ...f }),
  bundle: (f = {}) => createTestBundle({ slug: 'it', creatorId: owner.id, ...f }),
  paste: (f = {}) => createTestPaste(owner.id, { slug: 'it', ...f }),
  file: (f = {}) => createTestFile(owner.id, { slug: 'it', ...f })
};

describe('POST /api/reports (ReportController.submit)', () => {
  describe.each(Object.keys(MAKE))('%s', (type) => {
    it('stores a report with the hashed reporter IP', () => {
      const item = MAKE[type]();
      const res = submit({ type, id: item.id, reason: 'PHISHING', description: 'looks fake' });

      expect(res.statusCode).toBe(200);
      expect(res._jsonData.success).toBe(true);
      const row = db().prepare('SELECT * FROM reports').get();
      expect(row).toEqual(expect.objectContaining({
        targetType: type, targetId: item.id, reason: 'PHISHING', description: 'looks fake', status: 'pending'
      }));
      expect(row.reporterIpHash).toBe(ipHash.hashIp('203.0.113.1')); // keyed with IP_HASH_SECRET
      expect(JSON.stringify(row)).not.toContain('203.0.113.1');
    });

    it('accepts one report per reporter', () => {
      const item = MAKE[type]();
      submit({ type, id: item.id, reason: 'SPAM' });
      const again = submit({ type, id: item.id, reason: 'FRAUD' });

      expect(again.statusCode).toBe(400);
      expect(again._jsonData.error).toMatch(/already reported/i);
      expect(statuses(type, item.id)).toHaveLength(1);
    });

    it('quarantines at the threshold', () => {
      const item = MAKE[type]();
      reportFrom(type, item.id, 2);
      expect(flags(type, item.id).isQuarantined).toBe(0);

      const res = reportFrom(type, item.id, 1, 3);
      expect(res._jsonData.quarantined).toBe(true);
      expect(flags(type, item.id)).toEqual({ isBlocked: 0, isQuarantined: 1 });
      expect(auditActions()).toContain(`QUARANTINE_${type.toUpperCase()}`);
    });

    it.each([
      ['expired', { expiresAt: PAST }],
      ['blocked', { isBlocked: 1 }]
    ])('refuses a report on an item that is %s (410)', (_state, fields) => {
      const item = MAKE[type](fields);
      const res = submit({ type, id: item.id, reason: 'SPAM' });
      expect(res.statusCode).toBe(410);
      expect(statuses(type, item.id)).toEqual([]);
    });

    it('404s an unknown item', () => {
      expect(submit({ type, id: 99999, reason: 'SPAM' }).statusCode).toBe(404);
    });
  });

  it('400s a missing or unknown reason, and an unknown type', () => {
    const url = MAKE.url();
    expect(submit({ type: 'url', id: url.id }).statusCode).toBe(400);
    expect(submit({ type: 'url', id: url.id, reason: 'BORING' }).statusCode).toBe(400);
    expect(submit({ type: 'nope', id: url.id, reason: 'SPAM' }).statusCode).toBe(400);
    expect(submit({ reason: 'SPAM' }).statusCode).toBe(400);
  });

  it('lets people report restricted files they can see', () => {
    const file = MAKE.file({ sharingMode: 'restricted', allowedUsers: '[]' });
    expect(submit({ type: 'file', id: file.id, reason: 'MALWARE' }).statusCode).toBe(200);
  });

  it('lets owners report their own items', () => {
    const paste = MAKE.paste();
    expect(submit({ type: 'paste', id: paste.id, reason: 'SPAM' }, '203.0.113.1', owner).statusCode).toBe(200);
  });

  it.each([
    ['paste', 'pastes'], ['file', 'files'], ['bundle', 'bundles']
  ])('404s %s reports when that feature is off', (type, feature) => {
    setSettings({ features: { [feature]: false } });
    const item = MAKE[type]();
    expect(submit({ type, id: item.id, reason: 'SPAM' }).statusCode).toBe(404);
  });
});

describe('moderation of every type', () => {
  let admin;
  beforeEach(async () => {
    const row = await createTestUser({ username: 'boss', isAdmin: 1 });
    admin = { ...row, isAdmin: 1 };
  });
  const adminReq = () => createMockRequest({ user: admin, session: { userId: admin.id, isAdmin: true }, get: () => undefined });

  it.each(['paste', 'file'])('block and clear work for %ss', (type) => {
    const a = MAKE[type]({ slug: 'a' });
    const b = MAKE[type]({ slug: 'b' });
    reportFrom(type, a.id, 3);
    reportFrom(type, b.id, 3, 10);

    moderation.block(type, a.id, adminReq());
    moderation.clear(type, b.id, adminReq());

    expect(flags(type, a.id)).toEqual({ isBlocked: 1, isQuarantined: 0 });
    expect(statuses(type, a.id)).toEqual(['blocked', 'blocked', 'blocked']);
    expect(flags(type, b.id)).toEqual({ isBlocked: 0, isQuarantined: 0 });
    expect(statuses(type, b.id)).toEqual(['dismissed', 'dismissed', 'dismissed']);
  });

  it('lists quarantined items of every type', () => {
    for (const type of Object.keys(MAKE)) reportFrom(type, MAKE[type]({ slug: `q-${type}` }).id, 3);

    const list = moderation.listQuarantined();

    expect(list.map(q => q.type).sort()).toEqual(['bundle', 'file', 'paste', 'url']);
    expect(list.find(q => q.type === 'paste')).toEqual(expect.objectContaining({ slug: 'q-paste', path: '/p/q-paste', pendingReports: 3 }));
    expect(list.find(q => q.type === 'file')).toEqual(expect.objectContaining({ path: '/f/q-file' }));
  });
});

describe('admin report routes', () => {
  let admin, app;
  beforeEach(async () => {
    const row = await createTestUser({ username: 'boss', isAdmin: 1 });
    admin = { ...row, isAdmin: 1 };
    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.user = admin;
      req.session = { userId: admin.id, isAdmin: true };
      res.render = (view, data) => res.json({ view, ...data });
      next();
    });
    app.use(require('../../../routes/reportRoutes'));
    app.use((req, res) => res.status(404).json({ notFound: true }));
  });

  const reportOn = (type, fields) => {
    const item = MAKE[type](fields);
    submit({ type, id: item.id, reason: 'SPAM' }, `198.51.100.${item.id}`);
    return { item, report: db().prepare('SELECT * FROM reports WHERE targetType = ? AND targetId = ?').get(type, item.id) };
  };

  it('lists reports of every type, filterable by type, with counts per type', async () => {
    reportOn('url', { slug: 'u' });
    reportOn('bundle', { slug: 'b' });
    reportOn('paste', { slug: 'p' });
    reportOn('file', { slug: 'f' });

    const all = (await request(app).get('/admin/reports')).body;
    expect(all.type).toBe('all');
    expect(all.reports.map(r => r.targetType).sort()).toEqual(['bundle', 'file', 'paste', 'url']);
    expect(all.reports.find(r => r.targetType === 'paste')).toEqual(expect.objectContaining({ slug: 'p', path: '/p/p' }));
    expect(all.typeStats).toEqual(expect.objectContaining({
      all: expect.objectContaining({ pending: 4 }),
      paste: expect.objectContaining({ pending: 1 }),
      file: expect.objectContaining({ pending: 1 })
    }));

    const pastes = (await request(app).get('/admin/reports?type=paste')).body;
    expect(pastes.type).toBe('paste');
    expect(pastes.reports.map(r => r.targetType)).toEqual(['paste']);
  });

  it.each(Object.keys(MAKE))('blocks and unblocks a reported %s', async (type) => {
    const { item, report } = reportOn(type);

    expect((await request(app).put(`/api/admin/reports/${report.id}`).send({ action: 'block' })).status).toBe(200);
    expect(flags(type, item.id).isBlocked).toBe(1);
    expect(Report.findById(report.id).status).toBe('blocked');

    expect((await request(app).put(`/api/admin/reports/${report.id}`).send({ action: 'unblock' })).status).toBe(200);
    expect(flags(type, item.id).isBlocked).toBe(0);
    expect(Report.findById(report.id).status).toBe('reviewed');
  });

  it('changes a report status, and refuses an invalid one', async () => {
    const { report } = reportOn('paste');
    expect((await request(app).put(`/api/admin/reports/${report.id}`).send({ status: 'dismissed' })).status).toBe(200);
    expect(Report.findById(report.id).status).toBe('dismissed');
    expect((await request(app).put(`/api/admin/reports/${report.id}`).send({ status: 'weird' })).status).toBe(400);
  });

  it('deletes a report', async () => {
    const { report } = reportOn('file');
    expect((await request(app).delete(`/api/admin/reports/${report.id}`)).status).toBe(200);
    expect(Report.findById(report.id)).toBeUndefined();
    expect((await request(app).delete(`/api/admin/reports/${report.id}`)).status).toBe(404);
  });

  it('ban user: bans the owner and blocks everything they own', async () => {
    const { report } = reportOn('paste', { slug: 'reported' });
    const url = createTestUrl({ slug: 'theirs', creatorId: owner.id });
    const bundle = createTestBundle({ slug: 'theirs', creatorId: owner.id });
    const file = createTestFile(owner.id, { slug: 'theirs' });
    const other = createTestUrl({ slug: 'someone-else' });

    const res = await request(app).post(`/api/admin/reports/${report.id}/ban-user`).send({ userId: owner.id });

    expect(res.status).toBe(200);
    expect(db().prepare('SELECT isBanned FROM users WHERE id = ?').get(owner.id).isBanned).toBe(1);
    expect(flags('url', url.id).isBlocked).toBe(1);
    expect(flags('bundle', bundle.id).isBlocked).toBe(1);
    expect(flags('file', file.id).isBlocked).toBe(1);
    expect(flags('paste', report.targetId).isBlocked).toBe(1);
    expect(flags('url', other.id).isBlocked).toBe(0);
    expect(Report.findById(report.id).status).toBe('blocked');
  });

  it('ban user: refuses when the user is not the owner, or the item has none', async () => {
    const { report } = reportOn('url');
    expect((await request(app).post(`/api/admin/reports/${report.id}/ban-user`).send({ userId: admin.id })).status).toBe(400);

    const anon = createTestPaste(null, { slug: 'anon' });
    submit({ type: 'paste', id: anon.id, reason: 'SPAM' }, '192.0.2.1');
    const anonReport = db().prepare("SELECT id FROM reports WHERE targetType = 'paste' AND targetId = ?").get(anon.id);
    expect((await request(app).post(`/api/admin/reports/${anonReport.id}/ban-user`).send({ userId: null })).status).toBe(400);
  });
});

describe('report counts on links', () => {
  it('link lists and the info page count pending reports from the reports table', async () => {
    const url = MAKE.url();
    reportFrom('url', url.id, 2);
    db().prepare("UPDATE reports SET status = 'dismissed' WHERE id = (SELECT MIN(id) FROM reports)").run();

    expect(Url.findAllWithFilters({}).find(u => u.id === url.id).reportCount).toBe(1);
    expect(Url.findByCreatorIdWithFilters(owner.id).find(u => u.id === url.id).reportCount).toBe(1);
    expect(Url.findAllWithFilters({ hasReports: 'yes' }).map(u => u.id)).toEqual([url.id]);

    const res = createMockResponse();
    InfoController.getUrlInfo(createMockRequest({ params: { slug: 'it' }, get: () => undefined }), res);
    expect(res._viewData.reportCount).toBe(1);
  });
});
