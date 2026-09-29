const Url = require('../../../models/Url');
const { createTestUrl } = require('../../setup/testHelpers');

const PAST = '2000-01-01T00:00:00.000Z';
const FUTURE = '2999-01-01T00:00:00.000Z';

// The admin status filter (dropdown ?status= and @status:) uses the shared access statuses
beforeEach(() => {
  createTestUrl({ slug: 'live' });
  createTestUrl({ slug: 'locked', password: 'hash' });
  createTestUrl({ slug: 'used-up', clicks: 3, maxUses: 3 });
  createTestUrl({ slug: 'expired', expiresAt: PAST });
  createTestUrl({ slug: 'deactivated', deactivateAt: PAST });
  createTestUrl({ slug: 'later', activateAt: FUTURE });
  createTestUrl({ slug: 'blocked', isBlocked: 1 });
  createTestUrl({ slug: 'reported', isQuarantined: 1 });
});

const slugs = (rows) => rows.map(r => r.slug).sort();
const byStatus = (status) => slugs(Url.findAllWithFilters({ status }));
const byGroupStatus = (groupStatus) => slugs(Url.findAllWithFilters({ filterGroups: [{ groupStatus }] }));

describe('Url status filters', () => {
  it('active: live links only, password-protected ones included', () => {
    expect(byStatus('active')).toEqual(['live', 'locked']);
  });

  it('blocked', () => {
    expect(byStatus('blocked')).toEqual(['blocked']);
  });

  it('expired: past expiresAt or deactivateAt', () => {
    expect(byStatus('expired')).toEqual(['deactivated', 'expired']);
  });

  it('scheduled', () => {
    expect(byStatus('scheduled')).toEqual(['later']);
  });

  it('max-uses keeps its name and finds used-up links', () => {
    expect(byStatus('max-uses')).toEqual(['used-up']);
  });

  it('quarantined is a new filter value', () => {
    expect(byStatus('quarantined')).toEqual(['reported']);
  });

  it('@status: in the search syntax uses the same statuses', () => {
    expect(byGroupStatus('active')).toEqual(['live', 'locked']);
    expect(byGroupStatus('max-uses')).toEqual(['used-up']);
    expect(byGroupStatus('quarantined')).toEqual(['reported']);
  });

  it('keeps the non-status values working', () => {
    expect(byStatus('password-protected')).toEqual(['locked']);
    expect(byStatus('anonymous')).toHaveLength(8);
  });

  it('counts match the lists', () => {
    for (const status of ['active', 'expired', 'max-uses', 'quarantined']) {
      expect(Url.countAllWithFilters({ status })).toBe(byStatus(status).length);
    }
  });
});
