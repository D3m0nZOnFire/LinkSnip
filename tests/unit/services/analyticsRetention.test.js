const fs = require('fs');
const paths = require('../../../config/paths');
const configService = require('../../../services/configService');
const ScheduledTasks = require('../../../services/scheduledTasks');
const AnalyticsEvent = require('../../../models/AnalyticsEvent');
const { getTestDatabase } = require('../../setup/testDatabase');

// retention.analyticsDays: analytics events older than that are deleted nightly.
// null (the default) keeps them forever.

function setSettings(data) {
  fs.writeFileSync(paths.SETTINGS_PATH, JSON.stringify(data));
  configService.reload();
}
afterEach(() => {
  fs.rmSync(paths.SETTINGS_PATH, { force: true });
  configService.reload();
  jest.restoreAllMocks();
});

const oldEvent = () => {
  const { id } = AnalyticsEvent.record({ targetType: 'url', targetId: 1 });
  getTestDatabase().prepare("UPDATE analytics_events SET timestamp = '2000-01-01 00:00:00' WHERE id = ?").run(id);
};
const count = () => getTestDatabase().prepare('SELECT COUNT(*) AS n FROM analytics_events').get().n;

describe('retention.analyticsDays', () => {
  it('keeps analytics forever by default', () => {
    expect(configService.get('retention.analyticsDays')).toBeNull();
  });

  it('accepts a whole number of days or null, nothing else', () => {
    expect(() => configService.updateSettings({ 'retention.analyticsDays': 365 })).not.toThrow();
    expect(() => configService.updateSettings({ 'retention.analyticsDays': null })).not.toThrow();
    for (const bad of [0, -1, 1.5, 'forever']) {
      expect(() => configService.updateSettings({ 'retention.analyticsDays': bad })).toThrow(/retention\.analyticsDays/);
    }
  });
});

describe('ScheduledTasks.cleanupAnalytics', () => {
  beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => {}));

  it('deletes nothing while retention is off', () => {
    oldEvent();
    ScheduledTasks.cleanupAnalytics();
    expect(count()).toBe(1);
  });

  it('deletes events older than the setting and logs how many', () => {
    oldEvent();
    AnalyticsEvent.record({ targetType: 'url', targetId: 1 });
    setSettings({ retention: { analyticsDays: 30 } });

    ScheduledTasks.cleanupAnalytics();

    expect(count()).toBe(1);
    expect(console.log.mock.calls.flat().join(' ')).toMatch(/1 analytics event.*30 days/);
  });

  it('never throws (a failed cleanup is logged)', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(AnalyticsEvent, 'deleteOlderThan').mockImplementation(() => { throw new Error('disk I/O'); });
    setSettings({ retention: { analyticsDays: 30 } });
    expect(() => ScheduledTasks.cleanupAnalytics()).not.toThrow();
    expect(console.error).toHaveBeenCalled();
  });
});
