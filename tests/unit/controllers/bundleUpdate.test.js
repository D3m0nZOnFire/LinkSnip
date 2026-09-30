const bcrypt = require('bcrypt');
const BundleController = require('../../../controllers/bundleController');
const Bundle = require('../../../models/Bundle');
const { createTestUser, createTestBundle, createMockRequest, createMockResponse } = require('../../setup/testHelpers');

const FUTURE = '2999-01-01T00:00:00.000Z';
const ITEMS = [{ url: 'https://a.example' }, { url: 'https://b.example' }];

let owner, user;
beforeEach(async () => {
  const row = await createTestUser({ username: 'owner' });
  user = { id: row.id, username: 'owner', isAdmin: 0, role: null };
  owner = row;
});

async function update(bundle, body) {
  const res = createMockResponse();
  await BundleController.updateBundle(createMockRequest({ params: { id: String(bundle.id) }, body, user }), res);
  return res;
}

// The bundle edit form sends only title, description and items: every setting it
// doesn't send must stay as it is (before, they were all removed on every edit).
describe('PUT /api/bundles/:id keeps what it is not sent', () => {
  let bundle;
  beforeEach(async () => {
    bundle = createTestBundle({
      slug: 'bb', creatorId: owner.id, password: await bcrypt.hash('secret', 4),
      maxUses: 50, expiresAt: FUTURE, activateAt: '2026-01-01T09:00:00.000Z', deactivateAt: '2998-01-01T09:00:00.000Z'
    });
  });

  it('an edit of title, description and items keeps password, usage limit, expiry and schedule', async () => {
    const res = await update(bundle, { title: 'New title', description: 'New', items: ITEMS });
    expect(res.statusCode).toBe(200);

    const after = Bundle.findById(bundle.id);
    expect(after).toEqual(expect.objectContaining({
      title: 'New title', description: 'New', password: bundle.password, maxUses: 50,
      expiresAt: FUTURE, activateAt: '2026-01-01T09:00:00.000Z', deactivateAt: '2998-01-01T09:00:00.000Z'
    }));
  });

  // Password: '' means unchanged (forms leave it empty), null or removePassword removes it
  it('an empty value removes a setting', async () => {
    await update(bundle, {
      title: 'T', items: ITEMS, password: null, maxUses: null, expirationDays: null, activateDateTime: '', deactivateDateTime: null
    });
    expect(Bundle.findById(bundle.id)).toEqual(expect.objectContaining({
      password: null, maxUses: null, expiresAt: null, activateAt: null, deactivateAt: null
    }));
  });

  it('a new value replaces a setting', async () => {
    await update(bundle, {
      title: 'T', items: ITEMS, password: 'other', maxUses: 7, expirationDays: 3,
      activateDateTime: '2027-05-01T10:30', deactivateDateTime: '2027-06-01T10:30'
    });
    const after = Bundle.findById(bundle.id);

    expect(await bcrypt.compare('other', after.password)).toBe(true);
    expect(after.maxUses).toBe(7);
    const days = (new Date(after.expiresAt) - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(2.9);
    expect(days).toBeLessThan(3.1);
    expect(after.activateAt).toBe('2027-05-01T10:30:00.000Z');
    expect(after.deactivateAt).toBe('2027-06-01T10:30:00.000Z');
  });

  it('an empty description is removed, a missing one is kept', async () => {
    await update(bundle, { title: 'T', items: ITEMS, description: 'Keep me' });
    await update(bundle, { title: 'T', items: ITEMS });
    expect(Bundle.findById(bundle.id).description).toBe('Keep me');
    await update(bundle, { title: 'T', items: ITEMS, description: '' });
    expect(Bundle.findById(bundle.id).description).toBeNull();
  });
});
