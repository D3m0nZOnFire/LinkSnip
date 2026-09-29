// Mock Url model before requiring the controller
jest.mock('../../../models/Url', () => ({
  findAllWithFilters: jest.fn().mockReturnValue([]),
  countAllWithFilters: jest.fn().mockReturnValue(0)
}));

// AnalyticsShare is imported by the controller module; mock it to avoid DB dependency
jest.mock('../../../models/AnalyticsShare', () => ({
  findByUrlId: jest.fn().mockReturnValue([])
}));

const DashboardController = require('../../../controllers/dashboardController');
const Url = require('../../../models/Url');

/**
 * Build a mock request for getAdminDashboard.
 * @param {string} search - The search string to test
 * @param {object} extraQuery - Additional query params (e.g. { status: 'blocked' })
 */
function makeReq(search, extraQuery = {}) {
  return {
    query: {
      search: search || '',
      sort: '',
      status: '',
      hasReports: '',
      dateFrom: '',
      dateTo: '',
      ...extraQuery
    },
    protocol: 'http',
    get: () => 'localhost',
    user: { id: 1, username: 'admin', isAdmin: 1 },
    session: { userId: 1 }
  };
}

function makeRes() {
  return { render: jest.fn() };
}

/** Return the filterGroups from the most recent findAllWithFilters call. */
function getLastFilterGroups() {
  return Url.findAllWithFilters.mock.calls.at(-1)[0].filterGroups;
}

/** Return the full options object from the most recent findAllWithFilters call. */
function getLastCallOptions() {
  return Url.findAllWithFilters.mock.calls.at(-1)[0];
}

describe('Admin search parser (DashboardController.getAdminDashboard)', () => {
  describe('OR group splitting on |', () => {
    it('empty search → one group with empty cleanSearch', () => {
      DashboardController.getAdminDashboard(makeReq(''), makeRes());
      const groups = getLastFilterGroups();
      expect(groups).toHaveLength(1);
      expect(groups[0].cleanSearch).toBe('');
    });

    it('plain text → one group', () => {
      DashboardController.getAdminDashboard(makeReq('hello'), makeRes());
      const groups = getLastFilterGroups();
      expect(groups).toHaveLength(1);
      expect(groups[0].cleanSearch).toBe('hello');
    });

    it('pipe separator → two groups', () => {
      DashboardController.getAdminDashboard(makeReq('alice | bob'), makeRes());
      const groups = getLastFilterGroups();
      expect(groups).toHaveLength(2);
      expect(groups[0].cleanSearch).toBe('alice');
      expect(groups[1].cleanSearch).toBe('bob');
    });

    it('three groups separated by two pipes', () => {
      DashboardController.getAdminDashboard(makeReq('a | b | c'), makeRes());
      const groups = getLastFilterGroups();
      expect(groups).toHaveLength(3);
    });

    it('tokens in group 1 do not bleed into group 2', () => {
      DashboardController.getAdminDashboard(makeReq('@user:alice | @user:bob'), makeRes());
      const groups = getLastFilterGroups();
      expect(groups[0].creatorUsernames).toEqual(['alice']);
      expect(groups[1].creatorUsernames).toEqual(['bob']);
    });
  });

  describe('@user: accumulation', () => {
    it('single @user: populates creatorUsernames', () => {
      DashboardController.getAdminDashboard(makeReq('@user:alice'), makeRes());
      const groups = getLastFilterGroups();
      expect(groups[0].creatorUsernames).toEqual(['alice']);
    });

    it('two @user: tokens accumulate — not overwrite', () => {
      DashboardController.getAdminDashboard(makeReq('@user:alice @user:bob'), makeRes());
      const groups = getLastFilterGroups();
      expect(groups[0].creatorUsernames).toHaveLength(2);
      expect(groups[0].creatorUsernames).toContain('alice');
      expect(groups[0].creatorUsernames).toContain('bob');
    });

    it('@user:alice,bob CSV expands to two separate entries', () => {
      DashboardController.getAdminDashboard(makeReq('@user:alice,bob'), makeRes());
      const groups = getLastFilterGroups();
      expect(groups[0].creatorUsernames).toEqual(['alice', 'bob']);
    });

    it('@user: token is removed from cleanSearch', () => {
      DashboardController.getAdminDashboard(makeReq('foo @user:alice'), makeRes());
      const groups = getLastFilterGroups();
      expect(groups[0].cleanSearch).toBe('foo');
      expect(groups[0].cleanSearch).not.toContain('@user');
    });
  });

  describe('@user:! exclusion accumulation', () => {
    it('single @user:!alice populates excludeCreatorUsernames', () => {
      DashboardController.getAdminDashboard(makeReq('@user:!alice'), makeRes());
      const groups = getLastFilterGroups();
      expect(groups[0].excludeCreatorUsernames).toEqual(['alice']);
    });

    it('two @user:! tokens accumulate — not overwrite', () => {
      DashboardController.getAdminDashboard(makeReq('@user:!alice @user:!bob'), makeRes());
      const groups = getLastFilterGroups();
      expect(groups[0].excludeCreatorUsernames).toHaveLength(2);
      expect(groups[0].excludeCreatorUsernames).toContain('alice');
      expect(groups[0].excludeCreatorUsernames).toContain('bob');
    });

    it('@user:! token is removed from cleanSearch', () => {
      DashboardController.getAdminDashboard(makeReq('bar @user:!eve'), makeRes());
      const groups = getLastFilterGroups();
      expect(groups[0].cleanSearch).toBe('bar');
    });
  });

  describe('@anon flag', () => {
    it('sets isAnonymous=true', () => {
      DashboardController.getAdminDashboard(makeReq('@anon'), makeRes());
      const groups = getLastFilterGroups();
      expect(groups[0].isAnonymous).toBe(true);
    });

    it('does NOT set groupStatus (leaves it empty)', () => {
      DashboardController.getAdminDashboard(makeReq('@anon'), makeRes());
      const groups = getLastFilterGroups();
      expect(groups[0].groupStatus).toBe('');
    });

    it('stacks with @status:expired — both flags set', () => {
      DashboardController.getAdminDashboard(makeReq('@anon @status:expired'), makeRes());
      const groups = getLastFilterGroups();
      expect(groups[0].isAnonymous).toBe(true);
      expect(groups[0].groupStatus).toBe('expired');
    });

    it('@anon token is removed from cleanSearch', () => {
      DashboardController.getAdminDashboard(makeReq('@anon'), makeRes());
      const groups = getLastFilterGroups();
      expect(groups[0].cleanSearch).toBe('');
    });
  });

  describe('@user:anon and @user:anonymous shorthand', () => {
    it('@user:anon sets isAnonymous=true, not a username entry', () => {
      DashboardController.getAdminDashboard(makeReq('@user:anon'), makeRes());
      const groups = getLastFilterGroups();
      expect(groups[0].isAnonymous).toBe(true);
      expect(groups[0].creatorUsernames).toHaveLength(0);
    });

    it('@user:anonymous sets isAnonymous=true, not a username entry', () => {
      DashboardController.getAdminDashboard(makeReq('@user:anonymous'), makeRes());
      const groups = getLastFilterGroups();
      expect(groups[0].isAnonymous).toBe(true);
      expect(groups[0].creatorUsernames).toHaveLength(0);
    });

    it('@user:ivo,anon sets both ivo in creatorUsernames and isAnonymous=true', () => {
      DashboardController.getAdminDashboard(makeReq('@user:ivo,anon'), makeRes());
      const groups = getLastFilterGroups();
      expect(groups[0].creatorUsernames).toEqual(['ivo']);
      expect(groups[0].isAnonymous).toBe(true);
    });

    it('@user:ivo,admin,anon accumulates all three correctly', () => {
      DashboardController.getAdminDashboard(makeReq('@user:ivo,admin,anon'), makeRes());
      const groups = getLastFilterGroups();
      expect(groups[0].creatorUsernames).toContain('ivo');
      expect(groups[0].creatorUsernames).toContain('admin');
      expect(groups[0].creatorUsernames).toHaveLength(2);
      expect(groups[0].isAnonymous).toBe(true);
    });

    it('@user:anon is case-insensitive (ANON, Anon)', () => {
      DashboardController.getAdminDashboard(makeReq('@user:ANON'), makeRes());
      const g1 = getLastFilterGroups();
      expect(g1[0].isAnonymous).toBe(true);

      DashboardController.getAdminDashboard(makeReq('@user:Anon'), makeRes());
      const g2 = getLastFilterGroups();
      expect(g2[0].isAnonymous).toBe(true);
    });
  });

  describe('@protected flag', () => {
    it('sets isProtected=true', () => {
      DashboardController.getAdminDashboard(makeReq('@protected'), makeRes());
      const groups = getLastFilterGroups();
      expect(groups[0].isProtected).toBe(true);
    });

    it('does NOT set groupStatus (leaves it empty)', () => {
      DashboardController.getAdminDashboard(makeReq('@protected'), makeRes());
      const groups = getLastFilterGroups();
      expect(groups[0].groupStatus).toBe('');
    });

    it('stacks with @status:blocked — both flags set', () => {
      DashboardController.getAdminDashboard(makeReq('@protected @status:blocked'), makeRes());
      const groups = getLastFilterGroups();
      expect(groups[0].isProtected).toBe(true);
      expect(groups[0].groupStatus).toBe('blocked');
    });
  });

  describe('@status: token', () => {
    it('sets groupStatus', () => {
      DashboardController.getAdminDashboard(makeReq('@status:blocked'), makeRes());
      const groups = getLastFilterGroups();
      expect(groups[0].groupStatus).toBe('blocked');
    });

    it('@status: token is removed from cleanSearch', () => {
      DashboardController.getAdminDashboard(makeReq('@status:blocked'), makeRes());
      const groups = getLastFilterGroups();
      expect(groups[0].cleanSearch).toBe('');
    });
  });

  describe('@clicks: token', () => {
    it('@clicks:>10 → minClicks=10, maxClicks=null', () => {
      DashboardController.getAdminDashboard(makeReq('@clicks:>10'), makeRes());
      const groups = getLastFilterGroups();
      expect(groups[0].minClicks).toBe(10);
      expect(groups[0].maxClicks).toBeNull();
    });

    it('@clicks:<5 → maxClicks=5, minClicks=null', () => {
      DashboardController.getAdminDashboard(makeReq('@clicks:<5'), makeRes());
      const groups = getLastFilterGroups();
      expect(groups[0].maxClicks).toBe(5);
      expect(groups[0].minClicks).toBeNull();
    });

    it('@clicks:7 → both minClicks=7 and maxClicks=7 (exact match)', () => {
      DashboardController.getAdminDashboard(makeReq('@clicks:7'), makeRes());
      const groups = getLastFilterGroups();
      expect(groups[0].minClicks).toBe(7);
      expect(groups[0].maxClicks).toBe(7);
    });

    it('@clicks: token is removed from cleanSearch', () => {
      DashboardController.getAdminDashboard(makeReq('@clicks:>5'), makeRes());
      const groups = getLastFilterGroups();
      expect(groups[0].cleanSearch).toBe('');
    });
  });

  describe('dropdown status suppression (anyGroupHasStatus)', () => {
    it('dropdown status ignored when @status: present in search', () => {
      DashboardController.getAdminDashboard(makeReq('@status:blocked', { status: 'active' }), makeRes());
      expect(getLastCallOptions().status).toBe('');
    });

    it('dropdown status ignored when @anon present in search', () => {
      DashboardController.getAdminDashboard(makeReq('@anon', { status: 'active' }), makeRes());
      expect(getLastCallOptions().status).toBe('');
    });

    it('dropdown status ignored when @protected present in search', () => {
      DashboardController.getAdminDashboard(makeReq('@protected', { status: 'active' }), makeRes());
      expect(getLastCallOptions().status).toBe('');
    });

    it('dropdown status preserved when no status tokens in search', () => {
      DashboardController.getAdminDashboard(makeReq('hello', { status: 'blocked' }), makeRes());
      expect(getLastCallOptions().status).toBe('blocked');
    });

    it('dropdown status ignored when @status: is in just one OR group', () => {
      DashboardController.getAdminDashboard(makeReq('@status:blocked | hello', { status: 'active' }), makeRes());
      expect(getLastCallOptions().status).toBe('');
    });
  });

  describe('complex combined queries', () => {
    it('@user:alice @status:blocked @clicks:>5 — all three parsed in one group', () => {
      DashboardController.getAdminDashboard(makeReq('@user:alice @status:blocked @clicks:>5'), makeRes());
      const groups = getLastFilterGroups();
      expect(groups[0].creatorUsernames).toContain('alice');
      expect(groups[0].groupStatus).toBe('blocked');
      expect(groups[0].minClicks).toBe(5);
      expect(groups[0].cleanSearch).toBe('');
    });

    it('@anon @status:expired | @user:bob — two groups with different concerns', () => {
      DashboardController.getAdminDashboard(makeReq('@anon @status:expired | @user:bob'), makeRes());
      const groups = getLastFilterGroups();
      expect(groups).toHaveLength(2);
      expect(groups[0].isAnonymous).toBe(true);
      expect(groups[0].groupStatus).toBe('expired');
      expect(groups[1].creatorUsernames).toContain('bob');
    });
  });
});
