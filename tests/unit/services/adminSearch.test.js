const { parseSearch, effectiveStatus } = require('../../../services/itemList');

// The search syntax of Admin → Items (moved from the links list): groups separated by |, tokens within a group ANDed
describe('parseSearch (Admin → Items search)', () => {
  describe('OR group splitting on |', () => {
    it('empty search → one group with empty cleanSearch', () => {
      const groups = parseSearch('');
      expect(groups).toHaveLength(1);
      expect(groups[0].cleanSearch).toBe('');
    });

    it('plain text → one group', () => {
      const groups = parseSearch('hello');
      expect(groups).toHaveLength(1);
      expect(groups[0].cleanSearch).toBe('hello');
    });

    it('pipe separator → two groups', () => {
      const groups = parseSearch('alice | bob');
      expect(groups).toHaveLength(2);
      expect(groups[0].cleanSearch).toBe('alice');
      expect(groups[1].cleanSearch).toBe('bob');
    });

    it('three groups separated by two pipes', () => {
      const groups = parseSearch('a | b | c');
      expect(groups).toHaveLength(3);
    });

    it('tokens in group 1 do not bleed into group 2', () => {
      const groups = parseSearch('@user:alice | @user:bob');
      expect(groups[0].creatorUsernames).toEqual(['alice']);
      expect(groups[1].creatorUsernames).toEqual(['bob']);
    });
  });

  describe('@user: accumulation', () => {
    it('single @user: populates creatorUsernames', () => {
      const groups = parseSearch('@user:alice');
      expect(groups[0].creatorUsernames).toEqual(['alice']);
    });

    it('two @user: tokens accumulate — not overwrite', () => {
      const groups = parseSearch('@user:alice @user:bob');
      expect(groups[0].creatorUsernames).toHaveLength(2);
      expect(groups[0].creatorUsernames).toContain('alice');
      expect(groups[0].creatorUsernames).toContain('bob');
    });

    it('@user:alice,bob CSV expands to two separate entries', () => {
      const groups = parseSearch('@user:alice,bob');
      expect(groups[0].creatorUsernames).toEqual(['alice', 'bob']);
    });

    it('@user: token is removed from cleanSearch', () => {
      const groups = parseSearch('foo @user:alice');
      expect(groups[0].cleanSearch).toBe('foo');
      expect(groups[0].cleanSearch).not.toContain('@user');
    });
  });

  describe('@user:! exclusion accumulation', () => {
    it('single @user:!alice populates excludeCreatorUsernames', () => {
      const groups = parseSearch('@user:!alice');
      expect(groups[0].excludeCreatorUsernames).toEqual(['alice']);
    });

    it('two @user:! tokens accumulate — not overwrite', () => {
      const groups = parseSearch('@user:!alice @user:!bob');
      expect(groups[0].excludeCreatorUsernames).toHaveLength(2);
      expect(groups[0].excludeCreatorUsernames).toContain('alice');
      expect(groups[0].excludeCreatorUsernames).toContain('bob');
    });

    it('@user:! token is removed from cleanSearch', () => {
      const groups = parseSearch('bar @user:!eve');
      expect(groups[0].cleanSearch).toBe('bar');
    });
  });

  describe('@anon flag', () => {
    it('sets isAnonymous=true', () => {
      const groups = parseSearch('@anon');
      expect(groups[0].isAnonymous).toBe(true);
    });

    it('does NOT set groupStatus (leaves it empty)', () => {
      const groups = parseSearch('@anon');
      expect(groups[0].groupStatus).toBe('');
    });

    it('stacks with @status:expired — both flags set', () => {
      const groups = parseSearch('@anon @status:expired');
      expect(groups[0].isAnonymous).toBe(true);
      expect(groups[0].groupStatus).toBe('expired');
    });

    it('@anon token is removed from cleanSearch', () => {
      const groups = parseSearch('@anon');
      expect(groups[0].cleanSearch).toBe('');
    });
  });

  describe('@user:anon and @user:anonymous shorthand', () => {
    it('@user:anon sets isAnonymous=true, not a username entry', () => {
      const groups = parseSearch('@user:anon');
      expect(groups[0].isAnonymous).toBe(true);
      expect(groups[0].creatorUsernames).toHaveLength(0);
    });

    it('@user:anonymous sets isAnonymous=true, not a username entry', () => {
      const groups = parseSearch('@user:anonymous');
      expect(groups[0].isAnonymous).toBe(true);
      expect(groups[0].creatorUsernames).toHaveLength(0);
    });

    it('@user:ivo,anon sets both ivo in creatorUsernames and isAnonymous=true', () => {
      const groups = parseSearch('@user:ivo,anon');
      expect(groups[0].creatorUsernames).toEqual(['ivo']);
      expect(groups[0].isAnonymous).toBe(true);
    });

    it('@user:ivo,admin,anon accumulates all three correctly', () => {
      const groups = parseSearch('@user:ivo,admin,anon');
      expect(groups[0].creatorUsernames).toContain('ivo');
      expect(groups[0].creatorUsernames).toContain('admin');
      expect(groups[0].creatorUsernames).toHaveLength(2);
      expect(groups[0].isAnonymous).toBe(true);
    });

    it('@user:anon is case-insensitive (ANON, Anon)', () => {
      const g1 = parseSearch('@user:ANON');
      expect(g1[0].isAnonymous).toBe(true);

      const g2 = parseSearch('@user:Anon');
      expect(g2[0].isAnonymous).toBe(true);
    });
  });

  describe('@protected flag', () => {
    it('sets isProtected=true', () => {
      const groups = parseSearch('@protected');
      expect(groups[0].isProtected).toBe(true);
    });

    it('does NOT set groupStatus (leaves it empty)', () => {
      const groups = parseSearch('@protected');
      expect(groups[0].groupStatus).toBe('');
    });

    it('stacks with @status:blocked — both flags set', () => {
      const groups = parseSearch('@protected @status:blocked');
      expect(groups[0].isProtected).toBe(true);
      expect(groups[0].groupStatus).toBe('blocked');
    });
  });

  describe('@status: token', () => {
    it('sets groupStatus', () => {
      const groups = parseSearch('@status:blocked');
      expect(groups[0].groupStatus).toBe('blocked');
    });

    it('@status: token is removed from cleanSearch', () => {
      const groups = parseSearch('@status:blocked');
      expect(groups[0].cleanSearch).toBe('');
    });
  });

  describe('@clicks: token', () => {
    it('@clicks:>10 → minClicks=10, maxClicks=null', () => {
      const groups = parseSearch('@clicks:>10');
      expect(groups[0].minClicks).toBe(10);
      expect(groups[0].maxClicks).toBeNull();
    });

    it('@clicks:<5 → maxClicks=5, minClicks=null', () => {
      const groups = parseSearch('@clicks:<5');
      expect(groups[0].maxClicks).toBe(5);
      expect(groups[0].minClicks).toBeNull();
    });

    it('@clicks:7 → both minClicks=7 and maxClicks=7 (exact match)', () => {
      const groups = parseSearch('@clicks:7');
      expect(groups[0].minClicks).toBe(7);
      expect(groups[0].maxClicks).toBe(7);
    });

    it('@clicks: token is removed from cleanSearch', () => {
      const groups = parseSearch('@clicks:>5');
      expect(groups[0].cleanSearch).toBe('');
    });
  });

  describe('effectiveStatus: the status dropdown gives way to status tokens in the search', () => {
    it('dropdown status ignored when @status: present in search', () => {
      expect(effectiveStatus(parseSearch('@status:blocked'), 'active')).toBe('');
    });

    it('dropdown status ignored when @anon present in search', () => {
      expect(effectiveStatus(parseSearch('@anon'), 'active')).toBe('');
    });

    it('dropdown status ignored when @protected present in search', () => {
      expect(effectiveStatus(parseSearch('@protected'), 'active')).toBe('');
    });

    it('dropdown status preserved when no status tokens in search', () => {
      expect(effectiveStatus(parseSearch('hello'), 'blocked')).toBe('blocked');
    });

    it('dropdown status ignored when @status: is in just one OR group', () => {
      expect(effectiveStatus(parseSearch('@status:blocked | hello'), 'active')).toBe('');
    });
  });

  describe('complex combined queries', () => {
    it('@user:alice @status:blocked @clicks:>5 — all three parsed in one group', () => {
      const groups = parseSearch('@user:alice @status:blocked @clicks:>5');
      expect(groups[0].creatorUsernames).toContain('alice');
      expect(groups[0].groupStatus).toBe('blocked');
      expect(groups[0].minClicks).toBe(5);
      expect(groups[0].cleanSearch).toBe('');
    });

    it('@anon @status:expired | @user:bob — two groups with different concerns', () => {
      const groups = parseSearch('@anon @status:expired | @user:bob');
      expect(groups).toHaveLength(2);
      expect(groups[0].isAnonymous).toBe(true);
      expect(groups[0].groupStatus).toBe('expired');
      expect(groups[1].creatorUsernames).toContain('bob');
    });
  });
});

describe('@uses: (clicks, views or downloads, whatever the type counts)', () => {
  it('works like @clicks:', () => {
    expect(parseSearch('@uses:>10')[0]).toMatchObject({ minClicks: 10, maxClicks: null, cleanSearch: '' });
    expect(parseSearch('@uses:3')[0]).toMatchObject({ minClicks: 3, maxClicks: 3 });
  });
});
