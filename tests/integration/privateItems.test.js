const request = require('supertest');
const setupService = require('../../services/setupService');
const { createApp } = require('../../createApp');
const BioPage = require('../../models/BioPage');
const {
  createTestUser, createTestUrl, createTestBundle, createTestBundleItem, createTestPaste, createTestFile
} = require('../setup/testHelpers');

// Private items through the real app: a visitor who isn't logged in is sent to the login page, a logged-in
// stranger gets exactly what an address that doesn't exist gets, and the owner and admins open the item.

const SECRET = 'integration-test-session-secret-'.padEnd(64, 'x');
const app = () => createApp({ sessionSecret: SECRET });
const sameSite = { 'Sec-Fetch-Site': 'same-origin' };

async function loggedIn(user) {
  const agent = request.agent(app());
  const res = await agent.post('/login').set(sameSite).type('form').send({ username: user.username, password: 'password123' });
  expect(res.status).toBe(302);
  return agent;
}

let owner;
let stranger;
let admin;
let items;
beforeEach(async () => {
  setupService.reset();
  admin = await createTestUser({ username: 'boss', isAdmin: 1 });
  owner = await createTestUser({ username: 'owner' });
  stranger = await createTestUser({ username: 'stranger' });
  const bundle = createTestBundle({ slug: 'mybundle', creatorId: owner.id, isPrivate: 1 });
  createTestBundleItem(bundle.id, { url: 'https://one.example', position: 0 });
  items = {
    url: createTestUrl({ slug: 'mylink', longUrl: 'https://secret.example/path', creatorId: owner.id, isPrivate: 1 }),
    bundle,
    bundleItem: createTestBundleItem(bundle.id, { url: 'https://two.example', position: 1 }),
    paste: createTestPaste(owner.id, { slug: 'mypaste', content: 'top secret', isPrivate: 1 }),
    file: createTestFile(owner.id, { slug: 'myfile', isPrivate: 1 })
  };
});

// Each address of a private item, next to the same address for an item that doesn't exist
const ADDRESSES = [
  ['/s/mylink', '/s/nothing'],
  ['/info/mylink', '/info/nothing'],
  ['/b/mybundle', '/b/nothing'],
  [() => `/bt/${items.bundleItem.id}`, '/bt/999999'],
  ['/p/mypaste', '/p/nothing'],
  ['/p/mypaste/raw', '/p/nothing/raw'],
  ['/p-info/mypaste', '/p-info/nothing'],
  ['/f/myfile', '/f/nothing'],
  ['/f/myfile/download', '/f/nothing/download']
];
// Not pages anyone visits: whoever can't open the item gets the answer for an unknown slug, logged in or not
const QR_ADDRESSES = [
  ['/qrcode/url/mylink', '/qrcode/url/nothing'],
  ['/qrcode/paste/mypaste?format=svg', '/qrcode/paste/nothing?format=svg'],
  ['/qrcode/file/myfile/download', '/qrcode/file/nothing/download'],
  ['/api/qrcode/bundle/mybundle/dataurl', '/api/qrcode/bundle/nothing/dataurl']
];
const resolve = (address) => (typeof address === 'function' ? address() : address);

describe.each(ADDRESSES)('%s', (privateAddress, unknownAddress) => {
  it('sends a visitor who is not logged in to the login page and back', async () => {
    const address = resolve(privateAddress);
    const res = await request(app()).get(address);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/login?next=${encodeURIComponent(address)}`);
  });

  it('gives a logged-in stranger the same answer as an address that does not exist', async () => {
    const agent = await loggedIn(stranger);
    const hidden = await agent.get(resolve(privateAddress));
    const unknown = await agent.get(unknownAddress);
    expect(hidden.status).toBe(404);
    expect(hidden.status).toBe(unknown.status);
    expect(hidden.headers['content-type']).toBe(unknown.headers['content-type']);
    expect(hidden.text).toBe(unknown.text);
  });
});

describe.each(QR_ADDRESSES)('%s', (privateAddress, unknownAddress) => {
  it.each([['a visitor who is not logged in', false], ['a logged-in stranger', true]])(
    '%s gets the same answer as for an unknown slug', async (_who, logIn) => {
      const agent = logIn ? await loggedIn(stranger) : request.agent(app());
      const hidden = await agent.get(privateAddress);
      const unknown = await agent.get(unknownAddress);
      expect(hidden.status).toBe(404);
      expect(hidden.headers['content-type']).toBe(unknown.headers['content-type']);
      expect(hidden.text).toBe(unknown.text);
    });
});

describe('the owner and admins', () => {
  it.each([
    ['/s/mylink', 302],
    ['/info/mylink', 200],
    ['/b/mybundle', 200],
    ['/p/mypaste', 200],
    ['/p/mypaste/raw', 200],
    ['/p-info/mypaste', 200],
    ['/f/myfile', 200],
    ['/qrcode/url/mylink', 200]
  ])('open %s', async (address, status) => {
    for (const user of [owner, admin]) {
      const res = await (await loggedIn(user)).get(address);
      expect(res.status).toBe(status);
    }
  });

  it('see that the item is private', async () => {
    const res = await (await loggedIn(owner)).get('/p/mypaste');
    expect(res.text).toMatch(/Private/);
  });
});

describe('the unlock page of a private item with a password', () => {
  beforeEach(() => {
    require('../setup/testDatabase').getTestDatabase().prepare('UPDATE pastes SET password = ? WHERE id = ?').run('$2b$10$hash', items.paste.id);
  });

  it('is not shown to a stranger', async () => {
    const agent = await loggedIn(stranger);
    const hidden = await agent.get('/unlock/paste/mypaste');
    const unknown = await agent.get('/unlock/paste/nothing');
    expect(hidden.status).toBe(404);
    expect(hidden.text).toBe(unknown.text);
  });

  it('is shown to the owner', async () => {
    expect((await (await loggedIn(owner)).get('/unlock/paste/mypaste')).status).toBe(200);
  });
});

describe('reports', () => {
  it.each([['a visitor who is not logged in', false], ['a logged-in stranger', true]])(
    '%s cannot report a private item: it is unknown to them', async (_who, logIn) => {
    const agent = logIn ? await loggedIn(stranger) : request.agent(app());
    const report = (id) => agent.post('/api/reports').set(sameSite).send({ type: 'paste', id, reason: 'SPAM' });
    const hidden = await report(items.paste.id);
    const unknown = await report(999999);
    expect(hidden.status).toBe(404);
    expect(hidden.body).toEqual(unknown.body);
  });
});

describe('the bio page', () => {
  it('leaves private links out', async () => {
    const publicLink = createTestUrl({ slug: 'openlink', longUrl: 'https://open.example', creatorId: owner.id });
    const bio = BioPage.create(owner.id, 'Owner');
    BioPage.attachUrl(bio.id, publicLink.id);
    BioPage.attachUrl(bio.id, items.url.id);
    const res = await request(app()).get('/bio/owner');
    expect(res.status).toBe(200);
    expect(res.text).toContain('open.example');
    expect(res.text).not.toContain('secret.example');
  });
});

describe('the old file sharing list', () => {
  it('took usernames through /api/users/lookup, which is gone', async () => {
    const res = await (await loggedIn(owner)).get('/api/users/lookup?username=stranger');
    expect(res.status).toBe(404);
  });
});
