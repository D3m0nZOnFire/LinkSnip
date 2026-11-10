const events = require('../../../services/notificationEvents');

// What can be notified, how each event reads, and its defaults (in-app on for all; mail for what needs action).

const ALL = [
  'report_received', 'quarantined', 'quarantine_cleared', 'blocked', 'unblocked', 'account_banned',
  'expires_soon', 'expired', 'limit_reached', 'deleted_by_cleanup',
  'team_invited', 'team_role_changed', 'team_removed', 'team_deleted'
];
const MAIL_BY_DEFAULT = ['quarantined', 'blocked', 'account_banned', 'expires_soon', 'expired', 'limit_reached', 'team_invited'];

const item = { type: 'url', noun: 'link', address: '/s/abc', path: '/info/abc' };

describe('notificationEvents', () => {
  it('lists every event', () => {
    expect(Object.keys(events.EVENTS).sort()).toEqual([...ALL].sort());
  });

  it('looks up own keys only', () => {
    expect(events.event('blocked')).toEqual(expect.objectContaining({ group: 'moderation' }));
    expect(events.event('constructor')).toBeNull();
    expect(events.event('__proto__')).toBeNull();
    expect(events.event('nope')).toBeNull();
  });

  it('has every event in a group, and every group has a label', () => {
    for (const name of ALL) {
      const spec = events.event(name);
      expect(events.GROUPS.map(g => g.id)).toContain(spec.group);
      expect(typeof spec.label).toBe('string');
    }
  });

  it('turns in-app on for every toggleable event and mail on only for what needs action', () => {
    for (const name of events.toggleableEvents()) {
      expect(events.event(name).defaults.inApp).toBe(true);
      expect(events.event(name).defaults.mail).toBe(MAIL_BY_DEFAULT.includes(name));
    }
  });

  it('makes the ban mail-only, not toggleable and immediate', () => {
    expect(events.event('account_banned')).toEqual(expect.objectContaining({
      toggleable: false, immediate: true, defaults: { inApp: false, mail: true }
    }));
    expect(events.toggleableEvents()).not.toContain('account_banned');
  });

  describe('describe()', () => {
    it('names the item and links to it', () => {
      expect(events.describe('blocked', { item })).toEqual({
        text: 'Your link /s/abc was blocked by an administrator. Visitors can no longer open it.',
        path: '/info/abc'
      });
    });

    it('says how many days are left', () => {
      expect(events.describe('expires_soon', { item, days: 1 }).text).toMatch(/expires in 1 day\b/);
      expect(events.describe('expires_soon', { item, days: 3 }).text).toMatch(/expires in 3 days/);
      expect(events.describe('expired', { item, days: 90 }).text).toMatch(/deleted in 90 days/);
    });

    it('names the usage limit in the singular for 1', () => {
      expect(events.describe('limit_reached', { item, limit: 1, unit: 'clicks' }).text).toMatch(/limit of 1 click:/);
      expect(events.describe('limit_reached', { item, limit: 1, unit: 'downloads' }).text).toMatch(/limit of 1 download:/);
      expect(events.describe('limit_reached', { item, limit: 5, unit: 'views' }).text).toMatch(/limit of 5 views:/);
      expect(events.describe('limit_reached', { item, limit: 1 }).text).toMatch(/limit of 1 use:/);
    });

    it('has no link for a deleted item or team', () => {
      expect(events.describe('deleted_by_cleanup', { item: { ...item, path: null } }).path).toBeNull();
      expect(events.describe('team_deleted', { team: { id: 3, name: 'Ops' } }).path).toBeNull();
    });

    it('links team events to the team, invites to the dashboard', () => {
      expect(events.describe('team_role_changed', { team: { id: 3, name: 'Ops' }, role: 'admin' }))
        .toEqual({ text: 'Your role in the team Ops is now admin.', path: '/teams/3' });
      expect(events.describe('team_invited', { team: { id: 3, name: 'Ops' }, role: 'member', by: 'ann' }))
        .toEqual({ text: 'ann invited you to the team Ops as member.', path: '/dashboard' });
    });

    it('describes every event without throwing', () => {
      for (const name of ALL) {
        const { text } = events.describe(name, { item, days: 2, team: { id: 1, name: 'T' }, role: 'viewer', by: 'x' });
        expect(text.length).toBeGreaterThan(10);
      }
    });
  });
});
