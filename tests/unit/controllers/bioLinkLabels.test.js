const express = require('express');
const request = require('supertest');
const BioPage = require('../../../models/BioPage');
const BioPageController = require('../../../controllers/bioPageController');
const { createTestUser, createTestUrl } = require('../../setup/testHelpers');

// Each link on a bio page can have a label ("My YouTube channel"); without one the page shows the domain.

let alice, bob, page, url;
beforeEach(async () => {
  const a = await createTestUser({ username: 'alice', role: 'trusted' });
  const b = await createTestUser({ username: 'bob', role: 'trusted' });
  alice = { id: a.id, username: 'alice', role: 'trusted', isAdmin: 0 };
  bob = { id: b.id, username: 'bob', role: 'trusted', isAdmin: 0 };
  page = BioPage.create(alice.id, 'Alice');
  url = createTestUrl({ slug: 'yt', creatorId: alice.id, longUrl: 'https://www.youtube.com/@alice' });
  BioPage.attachUrl(page.id, url.id);
});

describe('BioPage.setUrlLabel', () => {
  it('stores the label trimmed; getUrls returns it', () => {
    BioPage.setUrlLabel(page.id, url.id, '  My channel  ');
    expect(BioPage.getUrls(page.id)[0].label).toBe('My channel');
  });

  it('an empty label removes it', () => {
    BioPage.setUrlLabel(page.id, url.id, 'x');
    BioPage.setUrlLabel(page.id, url.id, '   ');
    expect(BioPage.getUrls(page.id)[0].label).toBeNull();
  });
});

describe('PUT /api/bio/urls/:urlId/label', () => {
  const app = (user) => {
    const a = express();
    a.use(express.json());
    a.use((req, res, next) => { req.user = user; req.session = { userId: user.id }; next(); });
    a.put('/api/bio/urls/:urlId/label', BioPageController.setUrlLabel);
    return a;
  };
  const put = (user, id, label) => request(app(user)).put(`/api/bio/urls/${id}/label`).send({ label });

  it('sets the label of a link on your page', async () => {
    const res = await put(alice, url.id, 'My channel');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, label: 'My channel' });
  });

  it('refuses a label over 100 characters', async () => {
    expect((await put(alice, url.id, 'x'.repeat(101))).status).toBe(400);
  });

  it('only for links on your own page', async () => {
    const other = createTestUrl({ slug: 'other', creatorId: alice.id });
    expect((await put(alice, other.id, 'x')).status).toBe(404);
    expect((await put(bob, url.id, 'x')).status).toBe(404);
  });
});

describe('Bio settings: a label field per link on the page', () => {
  it('the settings page gets each link\'s label', async () => {
    const { createMockRequest, createMockResponse } = require('../../setup/testHelpers');
    BioPage.setUrlLabel(page.id, url.id, 'My channel');
    const res = createMockResponse();
    BioPageController.getBioSettings(createMockRequest({ user: alice, session: { userId: alice.id } }), res);
    expect(res._viewData.bioLabels.get(url.id)).toBe('My channel');
  });
});
