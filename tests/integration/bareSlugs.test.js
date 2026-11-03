const fs = require('fs');
const request = require('supertest');
const paths = require('../../config/paths');
const configService = require('../../services/configService');
const setupService = require('../../services/setupService');
const { createApp } = require('../../createApp');
const {
  createTestUser, createTestUrl, createTestBundle, createTestPaste, createTestFile
} = require('../setup/testHelpers');

// lnksnp.ch/<slug> without the type's prefix: it opens the item's real address, a link first. An item the visitor
// may not see (private) is skipped, so it answers like a slug nobody uses. Every other route comes first.

const SECRET = 'integration-test-session-secret-'.padEnd(64, 'x');
const app = () => createApp({ sessionSecret: SECRET });
const sameSite = { 'Sec-Fetch-Site': 'same-origin' };

function setSettings(settings) {
  fs.writeFileSync(paths.SETTINGS_PATH, JSON.stringify(settings));
  configService.reload();
}

async function loggedIn(user) {
  const agent = request.agent(app());
  const res = await agent.post('/login').set(sameSite).type('form').send({ username: user.username, password: 'password123' });
  expect(res.status).toBe(302);
  return agent;
}

let owner;
let stranger;
beforeEach(async () => {
  setupService.reset();
  await createTestUser({ username: 'boss', isAdmin: 1 });
  owner = await createTestUser({ username: 'owner' });
  stranger = await createTestUser({ username: 'stranger' });
});
afterEach(() => {
  fs.rmSync(paths.SETTINGS_PATH, { force: true });
  configService.reload();
});

describe('one item with the slug', () => {
  it.each([
    ['a link', () => createTestUrl({ slug: 'gm8', creatorId: owner.id }), '/s/gm8'],
    ['a bundle', () => createTestBundle({ slug: 'gm8', creatorId: owner.id }), '/b/gm8'],
    ['a paste', () => createTestPaste(owner.id, { slug: 'gm8' }), '/p/gm8'],
    ['a file', () => createTestFile(owner.id, { slug: 'gm8' }), '/f/gm8']
  ])('%s opens at its own address', async (_name, create, location) => {
    create();
    const res = await request(app()).get('/gm8');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(location);
  });

  it('ignores case and sends to the slug as stored', async () => {
    createTestUrl({ slug: 'Docker', creatorId: owner.id });
    const res = await request(app()).get('/dOCKER');
    expect(res.headers.location).toBe('/s/Docker');
  });

  it('keeps the query string', async () => {
    createTestUrl({ slug: 'gm8', creatorId: owner.id });
    const res = await request(app()).get('/gm8?confirmed=1');
    expect(res.headers.location).toBe('/s/gm8?confirmed=1');
  });

  it('works for an anonymous link', async () => {
    createTestUrl({ slug: 'anon1', creatorId: null });
    const res = await request(app()).get('/anon1');
    expect(res.headers.location).toBe('/s/anon1');
  });

  it('leaves the rest to the real address: a blocked link still redirects there', async () => {
    createTestUrl({ slug: 'gone', creatorId: owner.id, isBlocked: 1 });
    const res = await request(app()).get('/gone');
    expect(res.headers.location).toBe('/s/gone');
  });
});

describe('several types with the slug', () => {
  it('opens the link first', async () => {
    createTestFile(owner.id, { slug: 'same' });
    createTestPaste(owner.id, { slug: 'same' });
    createTestBundle({ slug: 'same', creatorId: owner.id });
    createTestUrl({ slug: 'same', creatorId: owner.id });
    const res = await request(app()).get('/same');
    expect(res.headers.location).toBe('/s/same');
  });

  it('then bundles, pastes, files (the registry order)', async () => {
    createTestFile(owner.id, { slug: 'same' });
    createTestPaste(owner.id, { slug: 'same' });
    expect((await request(app()).get('/same')).headers.location).toBe('/p/same');
    createTestBundle({ slug: 'same', creatorId: owner.id });
    expect((await request(app()).get('/same')).headers.location).toBe('/b/same');
  });

  it('skips a type whose feature is switched off', async () => {
    setSettings({ features: { pastes: false } });
    createTestPaste(owner.id, { slug: 'same' });
    createTestFile(owner.id, { slug: 'same' });
    const res = await request(app()).get('/same');
    expect(res.headers.location).toBe('/f/same');
  });
});

describe('private items', () => {
  beforeEach(() => {
    createTestUrl({ slug: 'mylink', creatorId: owner.id, isPrivate: 1 });
  });

  it('open for the owner', async () => {
    const agent = await loggedIn(owner);
    const res = await agent.get('/mylink');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/s/mylink');
  });

  it.each([['a visitor who is not logged in', false], ['a logged-in stranger', true]])(
    'look like an unknown slug to %s', async (_who, logIn) => {
      const agent = logIn ? await loggedIn(stranger) : request.agent(app());
      const hidden = await agent.get('/mylink');
      const unknown = await agent.get('/nothing');
      expect(hidden.status).toBe(404);
      expect(hidden.headers['content-type']).toBe(unknown.headers['content-type']);
      expect(hidden.text).toBe(unknown.text);
    }
  );

  it('give way to a public item of another type with the slug', async () => {
    createTestPaste(owner.id, { slug: 'mylink' });
    const agent = await loggedIn(stranger);
    const res = await agent.get('/mylink');
    expect(res.headers.location).toBe('/p/mylink');
  });
});

describe('what it does not touch', () => {
  it('a route with the same name wins', async () => {
    createTestUrl({ slug: 'login', creatorId: owner.id });
    createTestUrl({ slug: 'privacy', creatorId: owner.id });
    expect((await request(app()).get('/login')).status).toBe(200);
    expect((await request(app()).get('/privacy')).status).toBe(200);
  });

  it('an unknown slug is a 404', async () => {
    expect((await request(app()).get('/nothing')).status).toBe(404);
  });

  it('a path that is no slug is a 404', async () => {
    expect((await request(app()).get('/not.a-slug')).status).toBe(404);
    expect((await request(app()).get(`/${'a'.repeat(21)}`)).status).toBe(404);
  });

  it('only GET', async () => {
    createTestUrl({ slug: 'gm8', creatorId: owner.id });
    expect((await request(app()).post('/gm8').set(sameSite)).status).toBe(404);
  });
});
