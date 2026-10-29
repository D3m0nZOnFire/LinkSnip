const Url = require('../../../models/Url');
const Bundle = require('../../../models/Bundle');
const Paste = require('../../../models/Paste');
const { createTestUser, createTestPaste } = require('../../setup/testHelpers');

// Every model stores isPrivate (0 or 1) on create and, where the model updates, on update.
describe('isPrivate in the models', () => {
  let user;
  beforeEach(async () => { user = await createTestUser(); });

  it('links: create', () => {
    expect(Url.create({ slug: 'priv1', longUrl: 'https://a.example', creatorId: user.id, isPrivate: 1 }).isPrivate).toBe(1);
    expect(Url.create({ slug: 'pub1', longUrl: 'https://a.example', creatorId: user.id }).isPrivate).toBe(0);
  });

  it('bundles: create and update', () => {
    const bundle = Bundle.create({ slug: 'priv2', title: 'B', creatorId: user.id, isPrivate: true });
    expect(bundle.isPrivate).toBe(1);
    expect(Bundle.update(bundle.id, { isPrivate: 0 }).isPrivate).toBe(0);
    expect(Bundle.update(bundle.id, { title: 'C' }).isPrivate).toBe(0);
  });

  it('pastes: create and update; not sent keeps it', () => {
    const paste = Paste.create({ userId: user.id, slug: 'priv3', content: 'x', isPrivate: 1 });
    expect(paste.isPrivate).toBe(1);
    expect(Paste.update(paste.id, { title: 'T' }).isPrivate).toBe(1);
    expect(Paste.update(paste.id, { isPrivate: 0 }).isPrivate).toBe(0);
    expect(createTestPaste(user.id).isPrivate).toBe(0);
  });
});
