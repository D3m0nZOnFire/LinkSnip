const geo = require('../../../services/geoService');
const ScheduledTasks = require('../../../services/scheduledTasks');

// The daily country-database check: never throws, and says what happened in the log.
describe('ScheduledTasks.updateGeoDatabase', () => {
  let log, warn;
  beforeEach(() => {
    log = jest.spyOn(console, 'log').mockImplementation(() => {});
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('logs a new file', async () => {
    jest.spyOn(geo, 'update').mockResolvedValue({ status: 'updated', month: '2026-09' });
    await ScheduledTasks.updateGeoDatabase();
    expect(log.mock.calls.flat().join(' ')).toMatch(/2026-09/);
  });

  it('warns when the download failed, with what it means', async () => {
    jest.spyOn(geo, 'update').mockResolvedValue({ status: 'failed', error: 'ECONNREFUSED' });
    await expect(ScheduledTasks.updateGeoDatabase()).resolves.toBeUndefined();
    expect(warn.mock.calls.flat().join(' ')).toMatch(/ECONNREFUSED/);
    expect(warn.mock.calls.flat().join(' ')).toMatch(/Unknown/);
  });

  it('stays quiet when the file is current or geo is off', async () => {
    for (const status of ['current', 'disabled']) {
      jest.spyOn(geo, 'update').mockResolvedValue({ status });
      await ScheduledTasks.updateGeoDatabase();
    }
    expect(warn).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
});
