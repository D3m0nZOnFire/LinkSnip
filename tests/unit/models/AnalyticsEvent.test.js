const AnalyticsEvent = require('../../../models/AnalyticsEvent');
const { getTestDatabase } = require('../../setup/testDatabase');
const {
  createTestUser, createTestUrl, createTestBundle, createTestBundleItem, createTestPaste, createTestFile
} = require('../../setup/testHelpers');

const today = () => new Date().toISOString().split('T')[0];
const event = (type, id, fields = {}) => AnalyticsEvent.record({
  targetType: type, targetId: id, ipHash: 'h', referrer: 'Direct', userAgent: 'UA',
  browser: 'Chrome', os: 'Linux', device: 'Desktop', country: 'Switzerland', ...fields
});
const at = (id, when) => getTestDatabase().prepare('UPDATE analytics_events SET timestamp = ? WHERE id = ?').run(when, id);

let owner;
beforeEach(async () => { owner = await createTestUser({ username: 'owner' }); });

const MAKE = {
  url: () => createTestUrl({ slug: `u${Math.random()}` }),
  bundle: () => createTestBundle({ slug: `b${Math.random()}` }),
  paste: () => createTestPaste(owner.id, { slug: `p${Math.random()}` }),
  file: () => createTestFile(owner.id, { slug: `f${Math.random()}` })
};

describe.each(Object.keys(MAKE))('AnalyticsEvent for a %s', (type) => {
  it('records events and counts them', () => {
    const item = MAKE[type]();
    expect(AnalyticsEvent.getTotal(type, item.id)).toBe(0);
    event(type, item.id);
    event(type, item.id, { ipHash: null, referrer: null, userAgent: null, browser: null, os: null, device: null, country: null });
    expect(AnalyticsEvent.getTotal(type, item.id)).toBe(2);
  });

  it('counts only its own events, not another item or type with the same ID', () => {
    const item = MAKE[type]();
    const other = MAKE[type]();
    event(type, other.id);
    event(type === 'url' ? 'paste' : 'url', item.id);
    expect(AnalyticsEvent.getTotal(type, item.id)).toBe(0);
  });

  it('counts unique visitors by IP hash', () => {
    const item = MAKE[type]();
    event(type, item.id, { ipHash: 'a' });
    event(type, item.id, { ipHash: 'a' });
    event(type, item.id, { ipHash: 'b' });
    expect(AnalyticsEvent.getUniqueVisitors(type, item.id)).toBe(2);
  });

  it('breaks events down by referrer, most first, with a limit', () => {
    const item = MAKE[type]();
    event(type, item.id, { referrer: 'https://a.example' });
    event(type, item.id, { referrer: 'https://a.example' });
    event(type, item.id, { referrer: 'https://b.example' });

    expect(AnalyticsEvent.getBreakdown(type, item.id, 'referrer')).toEqual([
      { referrer: 'https://a.example', count: 2 },
      { referrer: 'https://b.example', count: 1 }
    ]);
    expect(AnalyticsEvent.getBreakdown(type, item.id, 'referrer', 1)).toHaveLength(1);
  });

  it.each(['browser', 'os', 'device', 'country'])('breaks events down by %s', (column) => {
    const item = MAKE[type]();
    event(type, item.id, { [column]: 'X' });
    event(type, item.id, { [column]: 'X' });
    event(type, item.id, { [column]: 'Y' });
    expect(AnalyticsEvent.getBreakdown(type, item.id, column)).toEqual([{ [column]: 'X', count: 2 }, { [column]: 'Y', count: 1 }]);
  });

  it('refuses an unknown breakdown column (it goes into the SQL)', () => {
    const item = MAKE[type]();
    expect(() => AnalyticsEvent.getBreakdown(type, item.id, 'ipHash; DROP TABLE users')).toThrow();
  });
});

describe('AnalyticsEvent.getByDate (the per-day chart)', () => {
  it('shows 30 days of zeros without data', () => {
    const url = MAKE.url();
    const { data, period } = AnalyticsEvent.getByDate('url', url.id);
    expect(data).toHaveLength(30);
    expect(data.every(d => d.count === 0)).toBe(true);
    expect(period).toBe('Last 30 Days');
    expect(data[29].date).toBe(today());
  });

  it('puts an event on its day and fills the other days with zeros', () => {
    const url = MAKE.url();
    event('url', url.id);
    const { data } = AnalyticsEvent.getByDate('url', url.id);
    expect(data.find(d => d.date === today()).count).toBe(1);
    expect(data.reduce((sum, d) => sum + d.count, 0)).toBe(1);
  });

  it('widens to 90 days, then to all time, as the data gets older', () => {
    const url = MAKE.url();
    const ago = (n) => new Date(Date.now() - n * 86400000).toISOString().replace('T', ' ').slice(0, 19);
    at(event('url', url.id).id, ago(60));
    expect(AnalyticsEvent.getByDate('url', url.id)).toEqual(expect.objectContaining({ period: 'Last 90 Days' }));
    at(event('url', url.id).id, ago(200));
    const all = AnalyticsEvent.getByDate('url', url.id);
    expect(all.period).toBe('All Time');
    expect(all.data.length).toBeGreaterThan(199);
  });

  it('takes an explicit number of days', () => {
    const url = MAKE.url();
    event('url', url.id);
    const { data, period } = AnalyticsEvent.getByDate('url', url.id, 7);
    expect(data).toHaveLength(7);
    expect(period).toBe('Last 7 Days');
  });
});

describe('AnalyticsEvent.getSummary', () => {
  it('has the same fields for every type', () => {
    const paste = MAKE.paste();
    event('paste', paste.id, { ipHash: 'a' });
    event('paste', paste.id, { ipHash: 'b' });

    expect(AnalyticsEvent.getSummary('paste', paste.id)).toEqual({
      total: 2,
      uniqueVisitors: 2,
      byDate: expect.any(Array),
      byDatePeriod: 'Last 30 Days',
      referrers: [{ referrer: 'Direct', count: 2 }],
      browsers: [{ browser: 'Chrome', count: 2 }],
      os: [{ os: 'Linux', count: 2 }],
      devices: [{ device: 'Desktop', count: 2 }],
      countries: [{ country: 'Switzerland', count: 2 }]
    });
  });

  it('is empty for an item without events', () => {
    const file = MAKE.file();
    const summary = AnalyticsEvent.getSummary('file', file.id);
    expect(summary).toEqual(expect.objectContaining({ total: 0, uniqueVisitors: 0, referrers: [], countries: [] }));
  });
});

describe('bundle item clicks', () => {
  it('are counted per item, and not in the bundle\'s own total', () => {
    const bundle = MAKE.bundle();
    const a = createTestBundleItem(bundle.id, { url: 'https://a.example', label: 'A', position: 0 });
    const b = createTestBundleItem(bundle.id, { url: 'https://b.example', label: 'B', position: 1 });
    event('bundle', bundle.id);
    event('bundle', bundle.id, { subTargetId: a.id });
    event('bundle', bundle.id, { subTargetId: a.id });
    event('bundle', bundle.id, { subTargetId: b.id });

    expect(AnalyticsEvent.getTotal('bundle', bundle.id)).toBe(1);
    expect(AnalyticsEvent.getItemClicks(bundle.id)).toEqual([
      expect.objectContaining({ id: a.id, url: 'https://a.example', label: 'A', position: 0, clickCount: 2 }),
      expect.objectContaining({ id: b.id, label: 'B', clickCount: 1 })
    ]);
  });

  it('lists items without clicks with 0, in position order, only for that bundle', () => {
    const bundle = MAKE.bundle();
    const other = MAKE.bundle();
    createTestBundleItem(bundle.id, { label: 'second', position: 1 });
    createTestBundleItem(bundle.id, { label: 'first', position: 0 });
    createTestBundleItem(other.id, { label: 'elsewhere' });

    expect(AnalyticsEvent.getItemClicks(bundle.id).map(i => [i.label, i.clickCount])).toEqual([['first', 0], ['second', 0]]);
    expect(AnalyticsEvent.getItemClicks(MAKE.bundle().id)).toEqual([]);
  });
});

describe('across items', () => {
  it('getTopUrls ranks links by clicks, optionally within recent days', () => {
    const a = createTestUrl({ slug: 'aa', longUrl: 'https://a.example' });
    const b = createTestUrl({ slug: 'bb' });
    event('url', a.id); event('url', a.id); event('url', b.id);
    event('paste', b.id); event('paste', b.id); event('paste', b.id); // other types don't count

    expect(AnalyticsEvent.getTopUrls(10)).toEqual([
      expect.objectContaining({ urlId: a.id, slug: 'aa', longUrl: 'https://a.example', clicks: 2 }),
      expect.objectContaining({ urlId: b.id, clicks: 1 })
    ]);
    expect(AnalyticsEvent.getTopUrls(1)).toHaveLength(1);
  });

  it('countAll counts every event of a type', () => {
    const url = MAKE.url();
    event('url', url.id); event('url', url.id); event('paste', url.id);
    expect(AnalyticsEvent.countAll('url')).toBe(2);
  });
});
