const slugService = require('../../../services/slugService');
const { SlugError } = slugService;
const {
  createTestUser, createTestUrl, createTestBundle, createTestPaste, createTestFile
} = require('../../setup/testHelpers');

// One slug service for every content type: a type's slugs are unique within that type only (/s/thing and
// /b/thing can both exist) and ignore case (/s/Promo and /s/promo are the same short link).

let userId;
beforeEach(async () => {
  userId = (await createTestUser({ username: 'owner' })).id;
});

const CREATE = {
  url: (slug) => createTestUrl({ slug }),
  bundle: (slug) => createTestBundle({ slug }),
  paste: (slug) => createTestPaste(userId, { slug }),
  file: (slug) => createTestFile(userId, { slug })
};
const TYPES = Object.keys(CREATE);

describe('problem', () => {
  it.each(['a', 'abc', 'ABC', 'a1b2c', 'test-slug', 'test_slug', '12345678901234567890'])('accepts %p', (slug) => {
    expect(slugService.problem(slug)).toBeNull();
  });

  it.each(['', '123456789012345678901', 'test slug', 'test!slug', 'test@slug', 'test/slug', 'café', null, undefined])(
    'refuses %p with a message', (slug) => {
      expect(slugService.problem(slug)).toMatch(/1-20 characters/);
    });
});

describe.each(TYPES)('%s slugs', (type) => {
  it('isTaken finds an existing slug, ignoring case', () => {
    CREATE[type]('Promo');
    expect(slugService.isTaken(type, 'Promo')).toBe(true);
    expect(slugService.isTaken(type, 'promo')).toBe(true);
    expect(slugService.isTaken(type, 'PROMO')).toBe(true);
    expect(slugService.isTaken(type, 'other')).toBe(false);
  });

  it('isTaken leaves out the item itself (exceptId), so it can keep its slug or change only its case', () => {
    const item = CREATE[type]('promo');
    expect(slugService.isTaken(type, 'promo', { exceptId: item.id })).toBe(false);
    expect(slugService.isTaken(type, 'Promo', { exceptId: item.id })).toBe(false);
  });

  it('the same slug in another type is free', () => {
    CREATE[type]('thing');
    for (const other of TYPES.filter(t => t !== type)) expect(slugService.isTaken(other, 'thing')).toBe(false);
  });

  it('find returns the record, ignoring case', () => {
    const item = CREATE[type]('Promo');
    expect(slugService.find(type, 'promo')).toEqual(expect.objectContaining({ id: item.id, slug: 'Promo' }));
    expect(slugService.find(type, 'missing')).toBeUndefined();
  });

  it('generate returns a free 5-character slug', () => {
    const slug = slugService.generate(type);
    expect(slug).toMatch(/^[A-Za-z0-9_-]{5}$/);
    expect(slugService.isTaken(type, slug)).toBe(false);
  });

  it('resolve returns the requested slug (trimmed) when it is free', () => {
    expect(slugService.resolve(type, ' mine ')).toBe('mine');
  });

  it('resolve generates one when none is requested', () => {
    expect(slugService.resolve(type, '')).toMatch(/^[A-Za-z0-9_-]{5}$/);
    expect(slugService.resolve(type, null)).toMatch(/^[A-Za-z0-9_-]{5}$/);
  });

  it('resolve refuses an invalid or taken slug with a SlugError (400)', () => {
    CREATE[type]('taken');
    expect(() => slugService.resolve(type, 'bad slug!')).toThrow(SlugError);
    let error;
    try { slugService.resolve(type, 'TAKEN'); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(SlugError);
    expect(error.status).toBe(400);
    expect(error.message).toMatch(/already taken/i);
  });
});

it('generate gives up after many collisions instead of looping forever', () => {
  const spy = jest.spyOn(slugService, 'isTaken').mockReturnValue(true);
  expect(() => slugService.generate('url')).toThrow(/unique/i);
  spy.mockRestore();
});

it('refuses an unknown type', () => {
  expect(() => slugService.isTaken('nope', 'a')).toThrow(/Unknown content type/);
});
