const fs = require('fs');
const express = require('express');
const request = require('supertest');
const paths = require('../../../config/paths');
const configService = require('../../../services/configService');
const moderation = require('../../../services/moderationService');
const ReportController = require('../../../controllers/reportController');
const { getTestDatabase } = require('../../setup/testDatabase');
const {
  createTestUser, createTestUrl, createTestBundle, createMockRequest, createMockResponse
} = require('../../setup/testHelpers');

const db = () => getTestDatabase();
const urlRow = (id) => db().prepare('SELECT isBlocked, isQuarantined FROM urls WHERE id = ?').get(id);
const bundleRow = (id) => db().prepare('SELECT isBlocked, isQuarantined FROM bundles WHERE id = ?').get(id);
const reportStatuses = (table, col, id) => db().prepare(`SELECT status FROM ${table} WHERE ${col} = ? ORDER BY id`).all(id).map(r => r.status);
const auditActions = () => db().prepare('SELECT action FROM audit_logs ORDER BY id').all().map(r => r.action);

function setSettings(data) {
  fs.writeFileSync(paths.SETTINGS_PATH, JSON.stringify(data));
  configService.reload();
}

afterEach(() => {
  fs.rmSync(paths.SETTINGS_PATH, { force: true });
  configService.reload();
});

const adminReq = (admin) => createMockRequest({ user: admin, session: { userId: admin.id, isAdmin: true }, get: () => undefined });

function reportUrl(urlId, ip) {
  const res = createMockResponse();
  ReportController.submitReport(createMockRequest({ body: { urlId, reason: 'SPAM' }, ip, get: () => undefined }), res);
  return res;
}

function reportBundle(bundleId, ip) {
  const res = createMockResponse();
  ReportController.submitBundleReport(createMockRequest({ body: { bundleId, reason: 'SPAM' }, ip, get: () => undefined }), res);
  return res;
}

const reportFrom = (fn, id, count, start = 1) => {
  let res;
  for (let i = start; i < start + count; i++) res = fn(id, `203.0.113.${i}`);
  return res;
};

describe('quarantine after reports', () => {
  it('quarantines a link at the threshold of distinct reporters, without blocking it', async () => {
    const owner = await createTestUser({ username: 'owner' });
    const url = createTestUrl({ slug: 'bad', creatorId: owner.id });

    reportFrom(reportUrl, url.id, 2);
    expect(urlRow(url.id)).toEqual({ isBlocked: 0, isQuarantined: 0 });

    const res = reportFrom(reportUrl, url.id, 1, 3);
    expect(res._jsonData.quarantined).toBe(true);
    expect(urlRow(url.id)).toEqual({ isBlocked: 0, isQuarantined: 1 });
    expect(auditActions()).toContain('QUARANTINE_URL');
  });

  it('quarantines anonymous links too', () => {
    const url = createTestUrl({ slug: 'anon', creatorId: null });
    reportFrom(reportUrl, url.id, 3);
    expect(urlRow(url.id).isQuarantined).toBe(1);
  });

  it('never quarantines links owned by an admin', async () => {
    const admin = await createTestUser({ username: 'boss', isAdmin: 1 });
    const url = createTestUrl({ slug: 'mine', creatorId: admin.id });

    const res = reportFrom(reportUrl, url.id, 5);

    expect(res._jsonData.quarantined).toBe(false);
    expect(urlRow(url.id).isQuarantined).toBe(0);
  });

  it('never quarantines links owned by a role with skipAutoModeration', async () => {
    const owner = await createTestUser({ username: 'trusted', role: 'trusted' });
    const url = createTestUrl({ slug: 'safe', creatorId: owner.id });

    reportFrom(reportUrl, url.id, 5);

    expect(urlRow(url.id).isQuarantined).toBe(0);
  });

  it('never quarantines at threshold 0, but still collects reports', () => {
    setSettings({ moderation: { reportThreshold: 0 } });
    const url = createTestUrl({ slug: 'bad' });

    reportFrom(reportUrl, url.id, 6);

    expect(urlRow(url.id).isQuarantined).toBe(0);
    expect(reportStatuses('url_reports', 'urlId', url.id)).toHaveLength(6);
  });

  it('quarantines bundles the same way', () => {
    const bundle = createTestBundle({ slug: 'bb' });

    reportFrom(reportBundle, bundle.id, 2);
    expect(bundleRow(bundle.id).isQuarantined).toBe(0);
    const res = reportFrom(reportBundle, bundle.id, 1, 3);

    expect(res._jsonData.quarantined).toBe(true);
    expect(bundleRow(bundle.id)).toEqual({ isBlocked: 0, isQuarantined: 1 });
  });
});

describe('admin decisions', () => {
  let admin;
  beforeEach(async () => {
    const row = await createTestUser({ username: 'boss', isAdmin: 1 });
    admin = { ...row, isAdmin: 1 };
  });

  it('block: hard-blocks the link, lifts quarantine, marks pending reports blocked', () => {
    const url = createTestUrl({ slug: 'bad' });
    reportFrom(reportUrl, url.id, 3);

    moderation.block('url', url.id, adminReq(admin));

    expect(urlRow(url.id)).toEqual({ isBlocked: 1, isQuarantined: 0 });
    expect(reportStatuses('url_reports', 'urlId', url.id)).toEqual(['blocked', 'blocked', 'blocked']);
    expect(auditActions()).toContain('BLOCK_URL');
  });

  it('clear: lifts quarantine and dismisses pending reports', () => {
    const url = createTestUrl({ slug: 'fine' });
    reportFrom(reportUrl, url.id, 3);

    moderation.clear('url', url.id, adminReq(admin));

    expect(urlRow(url.id)).toEqual({ isBlocked: 0, isQuarantined: 0 });
    expect(reportStatuses('url_reports', 'urlId', url.id)).toEqual(['dismissed', 'dismissed', 'dismissed']);
    expect(auditActions()).toContain('CLEAR_QUARANTINE');
  });

  it('a cleared link needs a fresh set of reports to be quarantined again', () => {
    const url = createTestUrl({ slug: 'fine' });
    reportFrom(reportUrl, url.id, 3);
    moderation.clear('url', url.id, adminReq(admin));

    reportFrom(reportUrl, url.id, 2, 10);
    expect(urlRow(url.id).isQuarantined).toBe(0);
    reportFrom(reportUrl, url.id, 1, 12);
    expect(urlRow(url.id).isQuarantined).toBe(1);
  });

  it('block and clear work for bundles', () => {
    const a = createTestBundle({ slug: 'a' });
    const b = createTestBundle({ slug: 'b' });
    reportFrom(reportBundle, a.id, 3);
    reportFrom(reportBundle, b.id, 3);

    moderation.block('bundle', a.id, adminReq(admin));
    moderation.clear('bundle', b.id, adminReq(admin));

    expect(bundleRow(a.id)).toEqual({ isBlocked: 1, isQuarantined: 0 });
    expect(bundleRow(b.id)).toEqual({ isBlocked: 0, isQuarantined: 0 });
    expect(reportStatuses('bundle_reports', 'bundleId', b.id)).toEqual(['dismissed', 'dismissed', 'dismissed']);
  });

  it('throws for an unknown item or type', () => {
    expect(() => moderation.block('url', 99999, adminReq(admin))).toThrow(/not found/i);
    expect(() => moderation.clear('paste', 1, adminReq(admin))).toThrow(/type/i);
  });

  it('lists quarantined links and bundles with their pending report counts', () => {
    const url = createTestUrl({ slug: 'bad', longUrl: 'https://evil.example' });
    const bundle = createTestBundle({ slug: 'bb' });
    createTestUrl({ slug: 'ok' });
    reportFrom(reportUrl, url.id, 4);
    reportFrom(reportBundle, bundle.id, 3);

    const list = moderation.listQuarantined();

    expect(list).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'url', id: url.id, slug: 'bad', target: 'https://evil.example', pendingReports: 4 }),
      expect.objectContaining({ type: 'bundle', id: bundle.id, slug: 'bb', pendingReports: 3 })
    ]));
    expect(list).toHaveLength(2);
  });
});

describe('moderation routes', () => {
  function appAs(user) {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.user = user;
      req.session = user ? { userId: user.id, isAdmin: !!user.isAdmin } : {};
      res.render = (view, data) => res.json({ view, ...data });
      next();
    });
    app.use(require('../../../routes/reportRoutes'));
    app.use((req, res) => res.status(404).json({ notFound: true }));
    return app;
  }

  it('lets admins block and clear, and shows quarantined items on the reports page', async () => {
    const row = await createTestUser({ username: 'boss', isAdmin: 1 });
    const app = appAs({ ...row, isAdmin: 1 });
    const bad = createTestUrl({ slug: 'bad' });
    const ok = createTestUrl({ slug: 'ok' });
    reportFrom(reportUrl, bad.id, 3);
    reportFrom(reportUrl, ok.id, 3, 10);

    const page = await request(app).get('/admin/reports');
    expect(page.body.quarantined.map(q => q.slug).sort()).toEqual(['bad', 'ok']);

    expect((await request(app).post(`/api/admin/moderation/url/${bad.id}/block`)).status).toBe(200);
    expect((await request(app).post(`/api/admin/moderation/url/${ok.id}/clear`)).status).toBe(200);
    expect(urlRow(bad.id).isBlocked).toBe(1);
    expect(urlRow(ok.id).isQuarantined).toBe(0);
    expect((await request(app).post('/api/admin/moderation/url/99999/clear')).status).toBe(404);
    expect((await request(app).post('/api/admin/moderation/paste/1/clear')).status).toBe(400);
  });

  it('keeps non-admins out', async () => {
    const url = createTestUrl({ slug: 'bad' });
    reportFrom(reportUrl, url.id, 3);
    const app = appAs({ id: 5, isAdmin: 0 });

    expect((await request(app).post(`/api/admin/moderation/url/${url.id}/clear`)).status).toBe(302);
    expect(urlRow(url.id).isQuarantined).toBe(1);
  });
});
