const { canView, canEdit, actor } = require('../../../services/itemPermissions');

// Who may see and change an item. Teams will add to these rules; everything that checks ownership goes through here.

const owner = { id: 7, isAdmin: 0 };
const stranger = { id: 8, isAdmin: 0 };
const admin = { id: 9, isAdmin: 1 };

const ITEMS = {
  url: { id: 1, creatorId: 7 },
  bundle: { id: 1, creatorId: 7 },
  paste: { id: 1, userId: 7 },
  file: { id: 1, userId: 7 }
};

describe.each(Object.entries(ITEMS))('%s', (type, item) => {
  it.each([['canView', canView], ['canEdit', canEdit]])('%s: the owner and admins yes, others no', (name, check) => {
    expect(check(owner, type, item)).toBe(true);
    expect(check(admin, type, item)).toBe(true);
    expect(check(stranger, type, item)).toBe(false);
    expect(check(null, type, item)).toBe(false);
  });

  it('an item without an owner (anonymous) belongs to nobody but admins', () => {
    const anonymous = { id: 2, creatorId: null, userId: null };
    expect(canEdit(stranger, type, anonymous)).toBe(false);
    expect(canEdit({ id: null }, type, anonymous)).toBe(false);
    expect(canEdit(admin, type, anonymous)).toBe(true);
  });
});

it('reads the owner column of the type, not the other one', () => {
  expect(canEdit(owner, 'paste', { id: 1, creatorId: 7, userId: 8 })).toBe(false);
  expect(canEdit(owner, 'url', { id: 1, creatorId: 8, userId: 7 })).toBe(false);
});

it('throws on an unknown type (programmer error)', () => {
  expect(() => canEdit(owner, 'gizmo', {})).toThrow(/Unknown content type/);
});

describe('actor', () => {
  it('is req.user when set (fresh from the database)', () => {
    const user = { id: 3, isAdmin: 0 };
    expect(actor({ user, session: { userId: 3, isAdmin: true } })).toBe(user);
  });

  it('falls back to the session', () => {
    expect(actor({ session: { userId: 3, isAdmin: true } })).toEqual({ id: 3, isAdmin: true });
  });

  it('is null for visitors', () => {
    expect(actor({ session: {} })).toBeNull();
    expect(actor({})).toBeNull();
  });
});
