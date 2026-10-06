const { share, itemShare } = require('../../../services/sharePreview');
const { createTestUser, createTestUrl, createTestPaste, createTestFile } = require('../../setup/testHelpers');

const BASE = 'https://lnksnp.ch';

describe('share: the text of a chat preview (og:description, og:url)', () => {
  it('joins the facts and makes the address absolute', () => {
    expect(share({ baseUrl: BASE, path: '/p/notes', facts: ['Paste', '12 lines', 'markdown'] }))
      .toEqual({ description: 'Paste · 12 lines · markdown', url: 'https://lnksnp.ch/p/notes' });
  });

  it('leaves out empty facts', () => {
    expect(share({ baseUrl: BASE, path: '/b/kit', facts: ['Bundle', null, '', undefined, '3 links'] }).description)
      .toBe('Bundle · 3 links');
  });

  it('cuts a long description at 200 characters', () => {
    const { description } = share({ baseUrl: BASE, path: '/b/kit', facts: ['Bundle', 'x'.repeat(500)] });
    expect(description).toHaveLength(200);
    expect(description.endsWith('…')).toBe(true);
  });

  it('puts long text on one line', () => {
    expect(share({ baseUrl: BASE, path: '/b/kit', facts: ['Bundle', 'first\n\n  second'] }).description)
      .toBe('Bundle · first second');
  });
});

describe('itemShare: nothing about an item the visitor could not open as it is', () => {
  let owner;
  beforeEach(async () => { owner = await createTestUser({ username: 'owner' }); });
  const facts = ['Paste', '2 lines'];

  it('an active item: its facts and its public address', () => {
    const paste = createTestPaste(owner.id, { slug: 'notes' });
    expect(itemShare('paste', paste, { baseUrl: BASE, facts }))
      .toEqual({ description: 'Paste · 2 lines', url: 'https://lnksnp.ch/p/notes' });
  });

  it('another address of the item when given (info pages)', () => {
    const url = createTestUrl({ slug: 'go' });
    expect(itemShare('url', url, { baseUrl: BASE, path: '/info/go', facts: ['Short link'] }).url)
      .toBe('https://lnksnp.ch/info/go');
  });

  it.each([
    ['password-protected', { password: 'hash' }],
    ['reported (quarantined)', { isQuarantined: 1 }],
    ['blocked', { isBlocked: 1 }],
    ['expired', { expiresAt: '2000-01-01T00:00:00.000Z' }],
    ['used up', { views: 1, maxViews: 1 }]
  ])('a %s item: nothing (the generic site preview)', (_name, fields) => {
    const paste = createTestPaste(owner.id, { slug: 'notes', ...fields });
    expect(itemShare('paste', paste, { baseUrl: BASE, facts })).toBeNull();
  });

  it('a restricted file: nothing', () => {
    const file = createTestFile(owner.id, { slug: 'doc', sharingMode: 'restricted', allowedUsers: '[]' });
    expect(itemShare('file', file, { baseUrl: BASE, facts: ['File'] })).toBeNull();
  });
});
