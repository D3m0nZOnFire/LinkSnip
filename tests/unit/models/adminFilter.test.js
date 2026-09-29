const Url = require('../../../models/Url');

describe('Url._buildGroupSQL', () => {
  const NOW = new Date().toISOString();

  describe('empty group', () => {
    it('returns no conditions and no params', () => {
      const { conditions, params } = Url._buildGroupSQL({}, '', NOW);
      expect(conditions).toHaveLength(0);
      expect(params).toHaveLength(0);
    });
  });

  describe('cleanSearch', () => {
    it('adds LIKE condition across slug, longUrl, and username', () => {
      const { conditions, params } = Url._buildGroupSQL({ cleanSearch: 'hello' }, '', NOW);
      expect(conditions).toHaveLength(1);
      expect(conditions[0]).toMatch(/urls\.slug LIKE \?/);
      expect(conditions[0]).toMatch(/urls\.longUrl LIKE \?/);
      expect(conditions[0]).toMatch(/users\.username LIKE \?/);
      expect(params).toEqual(['%hello%', '%hello%', '%hello%']);
    });

    it('ignores empty string', () => {
      const { conditions } = Url._buildGroupSQL({ cleanSearch: '' }, '', NOW);
      expect(conditions).toHaveLength(0);
    });

    it('ignores whitespace-only string', () => {
      const { conditions } = Url._buildGroupSQL({ cleanSearch: '   ' }, '', NOW);
      expect(conditions).toHaveLength(0);
    });

    it('wraps the search term in % wildcards', () => {
      const { params } = Url._buildGroupSQL({ cleanSearch: 'abc' }, '', NOW);
      expect(params[0]).toBe('%abc%');
    });
  });

  describe('creatorUsernames', () => {
    it('single username produces one LIKE placeholder', () => {
      const { conditions, params } = Url._buildGroupSQL({ creatorUsernames: ['alice'] }, '', NOW);
      expect(conditions).toHaveLength(1);
      expect(conditions[0]).toBe('(users.username LIKE ?)');
      expect(params).toEqual(['%alice%']);
    });

    it('two usernames are joined with OR', () => {
      const { conditions, params } = Url._buildGroupSQL({ creatorUsernames: ['alice', 'bob'] }, '', NOW);
      expect(conditions[0]).toBe('(users.username LIKE ? OR users.username LIKE ?)');
      expect(params).toEqual(['%alice%', '%bob%']);
    });

    it('empty array adds no condition', () => {
      const { conditions } = Url._buildGroupSQL({ creatorUsernames: [] }, '', NOW);
      expect(conditions).toHaveLength(0);
    });
  });

  describe('excludeCreatorUsernames', () => {
    it('single exclusion adds NOT LIKE with NULL guard', () => {
      const { conditions, params } = Url._buildGroupSQL({ excludeCreatorUsernames: ['alice'] }, '', NOW);
      expect(conditions).toHaveLength(1);
      expect(conditions[0]).toContain('users.username IS NULL');
      expect(conditions[0]).toContain('users.username NOT LIKE ?');
      expect(params).toEqual(['%alice%']);
    });

    it('two exclusions are joined with AND', () => {
      const { conditions, params } = Url._buildGroupSQL({ excludeCreatorUsernames: ['alice', 'bob'] }, '', NOW);
      expect(conditions[0]).toContain('NOT LIKE ? AND users.username NOT LIKE ?');
      expect(params).toEqual(['%alice%', '%bob%']);
    });

    it('empty array adds no condition', () => {
      const { conditions } = Url._buildGroupSQL({ excludeCreatorUsernames: [] }, '', NOW);
      expect(conditions).toHaveLength(0);
    });
  });

  describe('clicks', () => {
    it('equal min and max uses exact = ?', () => {
      const { conditions, params } = Url._buildGroupSQL({ minClicks: 5, maxClicks: 5 }, '', NOW);
      expect(conditions).toContain('urls.clicks = ?');
      expect(params).toContain(5);
    });

    it('minClicks only adds >= ?', () => {
      const { conditions, params } = Url._buildGroupSQL({ minClicks: 10, maxClicks: null }, '', NOW);
      expect(conditions).toContain('urls.clicks >= ?');
      expect(params).toContain(10);
    });

    it('maxClicks only adds <= ?', () => {
      const { conditions, params } = Url._buildGroupSQL({ minClicks: null, maxClicks: 20 }, '', NOW);
      expect(conditions).toContain('urls.clicks <= ?');
      expect(params).toContain(20);
    });

    it('range adds both >= and <=', () => {
      const { conditions, params } = Url._buildGroupSQL({ minClicks: 3, maxClicks: 8 }, '', NOW);
      expect(conditions).toContain('urls.clicks >= ?');
      expect(conditions).toContain('urls.clicks <= ?');
      expect(params).toContain(3);
      expect(params).toContain(8);
    });

    it('null/null adds no condition', () => {
      const { conditions } = Url._buildGroupSQL({ minClicks: null, maxClicks: null }, '', NOW);
      expect(conditions).toHaveLength(0);
    });
  });

  describe('isAnonymous and isProtected flags', () => {
    it('@anon alone adds creatorId IS NULL', () => {
      const { conditions } = Url._buildGroupSQL({ isAnonymous: true }, '', NOW);
      expect(conditions).toContain('urls.creatorId IS NULL');
    });

    it('@protected adds password IS NOT NULL', () => {
      const { conditions } = Url._buildGroupSQL({ isProtected: true }, '', NOW);
      expect(conditions).toContain('urls.password IS NOT NULL');
    });

    it('@anon and @status:expired both appear (additive AND)', () => {
      const { conditions } = Url._buildGroupSQL({ isAnonymous: true, groupStatus: 'expired' }, '', NOW);
      expect(conditions).toContain('urls.creatorId IS NULL');
      expect(conditions.some(c => c.includes('expiresAt'))).toBe(true);
    });

    it('@protected and @status:blocked both appear (additive AND)', () => {
      const { conditions, params } = Url._buildGroupSQL({ isProtected: true, groupStatus: 'blocked' }, '', NOW);
      expect(conditions).toContain('urls.password IS NOT NULL');
      expect(conditions.some(c => c.includes('CASE'))).toBe(true);
      expect(params[params.length - 1]).toBe('blocked');
    });

    it('creatorUsernames + isAnonymous are OR-ed into a single condition', () => {
      const { conditions, params } = Url._buildGroupSQL({ creatorUsernames: ['alice'], isAnonymous: true }, '', NOW);
      // Should be ONE combined condition, not two separate AND conditions
      expect(conditions).toHaveLength(1);
      expect(conditions[0]).toContain('users.username LIKE ?');
      expect(conditions[0]).toContain('urls.creatorId IS NULL');
      expect(params).toEqual(['%alice%']);
    });

    it('multiple creatorUsernames + isAnonymous are OR-ed together', () => {
      const { conditions } = Url._buildGroupSQL({ creatorUsernames: ['alice', 'bob'], isAnonymous: true }, '', NOW);
      expect(conditions).toHaveLength(1);
      expect(conditions[0]).toContain('users.username LIKE ?');
      expect(conditions[0]).toContain('urls.creatorId IS NULL');
    });
  });

  // Status values filter on the shared access status (accessService.statusSql):
  // one condition "(CASE …) = ?" whose last param is the status. Which rows match
  // is tested against real rows in urlStatusFilter.test.js.
  const statusFilter = (group, globalStatus = '') => {
    const { conditions, params } = Url._buildGroupSQL(group, globalStatus, NOW);
    return { condition: conditions.find(c => c.includes('CASE')), status: params[params.length - 1], conditions, params };
  };

  describe('status resolution', () => {
    it('groupStatus takes priority over globalStatus', () => {
      const { status, conditions } = statusFilter({ groupStatus: 'blocked' }, 'active');
      expect(status).toBe('blocked');
      expect(conditions.filter(c => c.includes('CASE'))).toHaveLength(1);
    });

    it('falls back to globalStatus when groupStatus is empty', () => {
      expect(statusFilter({}, 'blocked').status).toBe('blocked');
    });

    it('no status condition added when both are empty', () => {
      const { conditions } = Url._buildGroupSQL({}, '', NOW);
      expect(conditions).toHaveLength(0);
    });
  });

  describe('status values', () => {
    it.each([
      ['active', 'active'],
      ['blocked', 'blocked'],
      ['expired', 'expired'],
      ['scheduled', 'scheduled'],
      ['max-uses', 'limit_reached'],
      ['quarantined', 'quarantined']
    ])('%s filters on the access status %s', (value, status) => {
      const filter = statusFilter({ groupStatus: value });
      expect(filter.condition).toMatch(/^\(CASE[\s\S]*END\) = \?$/);
      expect(filter.status).toBe(status);
      expect(filter.params).toContain(NOW);
    });
  });

  describe('status: anonymous', () => {
    it('adds creatorId IS NULL', () => {
      const { conditions } = Url._buildGroupSQL({ groupStatus: 'anonymous' }, '', NOW);
      expect(conditions).toContain('urls.creatorId IS NULL');
    });
  });

  describe('status: password-protected', () => {
    it('adds password IS NOT NULL', () => {
      const { conditions } = Url._buildGroupSQL({ groupStatus: 'password-protected' }, '', NOW);
      expect(conditions).toContain('urls.password IS NOT NULL');
    });
  });

  describe('multiple token types accumulate', () => {
    it('search + creatorUsernames + minClicks all produce independent conditions', () => {
      const { conditions } = Url._buildGroupSQL({
        cleanSearch: 'test',
        creatorUsernames: ['alice'],
        minClicks: 5,
        maxClicks: null
      }, '', NOW);
      expect(conditions).toHaveLength(3);
    });

    it('excludeCreatorUsernames + isAnonymous + status all coexist', () => {
      const { conditions } = Url._buildGroupSQL({
        excludeCreatorUsernames: ['eve'],
        isAnonymous: true,
        groupStatus: 'expired'
      }, '', NOW);
      expect(conditions.some(c => c.includes('NOT LIKE'))).toBe(true);
      expect(conditions).toContain('urls.creatorId IS NULL');
      expect(conditions.some(c => c.includes('expiresAt'))).toBe(true);
    });
  });
});
