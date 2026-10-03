const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const paths = require('../../../config/paths');
const configService = require('../../../services/configService');
const AnalyticsService = require('../../../services/analyticsService');
const geo = require('../../../services/geoService');
const adminOverview = require('../../../services/adminOverview');
const UrlController = require('../../../controllers/urlController');
const { isEnabled, featureRoutes } = require('../../../middleware/requireFeature');
const { viewLocals } = require('../../../middleware/viewLocals');
const { getTestDatabase } = require('../../setup/testDatabase');
const {
  createTestUser, createTestUrl, createMockRequest, createMockResponse
} = require('../../setup/testHelpers');

/**
 * features.analytics: off records no visits and hides everything that shows them. Events already recorded
 * are kept; item counters (clicks, views, downloads) keep counting, since usage limits depend on them.
 */
const db = () => getTestDatabase();
const events = () => db().prepare('SELECT COUNT(*) AS n FROM analytics_events').get().n;

function setSettings(settings) {
  fs.writeFileSync(paths.SETTINGS_PATH, JSON.stringify(settings));
  configService.reload();
}
const analyticsOff = (extra = {}) => setSettings({ features: { analytics: false }, ...extra });

afterEach(() => {
  fs.rmSync(paths.SETTINGS_PATH, { force: true });
  configService.reload();
  jest.restoreAllMocks();
});

describe('the setting', () => {
  it('is on by default', () => {
    expect(configService.get('features.analytics')).toBe(true);
  });
});

describe('share links depend on it', () => {
  it('analyticsShareLinks is off while analytics is off, whatever its own switch says', () => {
    analyticsOff({ features: { analytics: false, analyticsShareLinks: true } });
    expect(isEnabled('analyticsShareLinks')).toBe(false);
  });

  it('the share link routes fall through', () => {
    analyticsOff();
    const router = jest.fn();
    const next = jest.fn();
    featureRoutes('analyticsShareLinks', router)({}, {}, next);
    expect(router).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('views see both as off, and neither permission', async () => {
    analyticsOff();
    const user = await createTestUser({ username: 'alice' });
    const res = createMockResponse();
    viewLocals(createMockRequest({ user }), res, () => {});
    expect(res.locals.features.analytics).toBe(false);
    expect(res.locals.features.analyticsShareLinks).toBe(false);
    expect(res.locals.can.analytics).toBe(false);
    expect(res.locals.can.analyticsShareLinks).toBe(false);
  });
});

describe('recording', () => {
  it('records nothing and looks nothing up', async () => {
    analyticsOff();
    const lookup = jest.spyOn(geo, 'lookupCountry');
    const url = createTestUrl({ slug: 'a' });

    await AnalyticsService.record(createMockRequest(), 'url', url.id);

    expect(events()).toBe(0);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('records again once it is back on', async () => {
    const url = createTestUrl({ slug: 'a' });
    await AnalyticsService.record(createMockRequest(), 'url', url.id);
    expect(events()).toBe(1);
  });

  it('keeps the events recorded before it was switched off', async () => {
    const url = createTestUrl({ slug: 'a' });
    await AnalyticsService.record(createMockRequest(), 'url', url.id);
    analyticsOff();
    await AnalyticsService.record(createMockRequest(), 'url', url.id);
    expect(events()).toBe(1);
  });

  it('a link still counts its clicks (usage limits need them)', async () => {
    analyticsOff();
    const url = createTestUrl({ slug: 'a', maxUses: 5 });
    const res = createMockResponse();

    await UrlController.redirect(createMockRequest({ params: { slug: 'a' } }), res);

    expect(res.redirect).toHaveBeenCalledWith(302, url.longUrl);
    expect(db().prepare('SELECT clicks FROM urls WHERE id = ?').get(url.id).clicks).toBe(1);
    expect(events()).toBe(0);
  });
});

describe('the country database', () => {
  beforeEach(() => {
    global.fetch = jest.fn(() => { throw new Error('no network in tests'); });
  });

  it('is not downloaded while analytics is off, even with geo.enabled on', async () => {
    analyticsOff({ geo: { enabled: true } });
    expect(await geo.update()).toEqual({ status: 'disabled' });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('Admin → Overview', () => {
  it('has no visits figure while analytics is off', () => {
    analyticsOff();
    expect(adminOverview.summary().visits).toBeNull();
  });

  it('has one while it is on', () => {
    expect(adminOverview.summary().visits).toEqual({ lastWeek: 0, weekBefore: 0 });
  });
});

describe('pages', () => {
  // The routes as app.js mounts them, with a logged-in admin
  function appWith(router, user) {
    const app = express();
    app.use((req, res, next) => {
      req.session = { userId: user.id, isAdmin: true };
      req.user = user;
      next();
    });
    app.use(router);
    app.use((req, res) => res.status(404).send('not found'));
    return app;
  }

  it('app.js mounts the analytics routes behind the switch', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../../app.js'), 'utf8');
    expect(source).toMatch(/featureRoutes\('analytics', analyticsRoutes\)/);
  });

  it.each([
    '/tags/1/analytics',
    '/api/tags/1/analytics'
  ])('tag analytics (%s) are a 404', async (address) => {
    analyticsOff();
    const admin = await createTestUser({ username: 'boss', isAdmin: 1 });
    const res = await request(appWith(require('../../../routes/tagRoutes'), admin)).get(address);
    expect(res.status).toBe(404);
    expect(res.text).toBe('not found');
  });

  it('the tag list stays', async () => {
    analyticsOff();
    const admin = await createTestUser({ username: 'boss', isAdmin: 1 });
    const res = await request(appWith(require('../../../routes/tagRoutes'), admin)).get('/api/tags');
    expect(res.status).toBe(200);
  });
});
