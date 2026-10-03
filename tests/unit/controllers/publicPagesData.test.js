const express = require('express');
const request = require('supertest');
const teamService = require('../../../services/teamService');
const BundleController = require('../../../controllers/bundleController');
const InfoController = require('../../../controllers/infoController');
const { getTestDatabase } = require('../../setup/testDatabase');
const {
  createTestUser, createTestUrl, createTestBundle, createTestBundleItem, createMockRequest, createMockResponse
} = require('../../setup/testHelpers');

// What the public item pages get from their controllers (v1.3 part 6a)

async function render(handler, req) {
  const res = createMockResponse();
  await handler(createMockRequest({ protocol: 'http', get: () => 'localhost', session: {}, ...req }), res);
  return res;
}

describe('link info page', () => {
  it('passes the destination\'s host name (for "Continue to <domain>")', async () => {
    createTestUrl({ slug: 'yt', longUrl: 'https://www.youtube.com/watch?v=1' });
    const res = await render(InfoController.getUrlInfo, { params: { slug: 'yt' } });
    expect(res._viewData.destinationHost).toBe('www.youtube.com');
  });
});

describe('bundle page: who sees the Analytics link', () => {
  let owner, member, stranger, bundle;
  beforeEach(async () => {
    const user = async (name, role = 'trusted') => {
      const row = await createTestUser({ username: name, email: `${name}@example.com`, role });
      return { id: row.id, username: name, role, isAdmin: 0 };
    };
    owner = await user('owner');
    member = await user('member');
    stranger = await user('stranger');
    const team = teamService.create(owner, 'Acme');
    teamService.acceptInvite(member, teamService.invite(owner, team.id, 'member', 'viewer').id);
    bundle = createTestBundle({ slug: 'kit', creatorId: owner.id });
    createTestBundleItem(bundle.id, { url: 'https://example.com/a' });
    createTestBundleItem(bundle.id, { url: 'https://example.com/b' });
    getTestDatabase().prepare('UPDATE bundles SET teamId = ? WHERE id = ?').run(team.id, bundle.id);
  });

  const canSee = async (user) =>
    (await render(BundleController.launchBundle, { params: { slug: 'kit' }, user }))._viewData.canSeeAnalytics;

  it('follows the analytics page\'s rule (canView): the creator and team members, not strangers or visitors', async () => {
    expect(await canSee(owner)).toBe(true);
    expect(await canSee(member)).toBe(true);
    expect(await canSee(stranger)).toBe(false);
    expect(await canSee(null)).toBe(false);
  });
});

describe('bio page social links: icon names are checked', () => {
  const BioPageController = require('../../../controllers/bioPageController');
  let app, alice;
  beforeEach(async () => {
    const row = await createTestUser({ username: 'alice', role: 'trusted' });
    alice = { id: row.id, username: 'alice', role: 'trusted', isAdmin: 0 };
    app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.user = alice; req.session = { userId: alice.id }; next(); });
    app.put('/api/bio', BioPageController.updateBioPage);
  });

  const save = (icon) => request(app).put('/api/bio').send({
    displayName: 'Alice', theme: 'dark', socialLinks: [{ icon, platform: 'GitHub', url: 'https://github.com/a' }]
  });

  it('accepts icon names of letters, digits and dashes', async () => {
    for (const icon of ['github', 'logo-github', 'mail-outline', '1password']) {
      expect((await save(icon)).status).toBe(200);
    }
  });

  it('refuses anything else (they end up in an image address)', async () => {
    for (const icon of ["x');alert(1)//", 'a b', '../x', 'X<y>']) {
      const res = await save(icon);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/icon/i);
    }
  });

  it('a refused link is a normal 400, not a server error: nothing in the server log', async () => {
    const logged = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect((await save('a b')).status).toBe(400);
      expect((await request(app).put('/api/bio').send({ displayName: 'Alice', theme: 'dark', socialLinks: [{ icon: 'github', url: 'http://' }] })).status).toBe(400);
      expect(logged).not.toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });
});

describe('paste page: who sees Edit', () => {
  const pasteController = require('../../../controllers/pasteController');
  const { createTestPaste } = require('../../setup/testHelpers');

  it('follows itemPermissions.canEdit: the creator and team admins, not viewers or strangers', async () => {
    const user = async (name) => {
      const row = await createTestUser({ username: name, email: `${name}@example.com`, role: 'trusted' });
      return { id: row.id, username: name, role: 'trusted', isAdmin: 0 };
    };
    const owner = await user('powner');
    const admin = await user('padmin');
    const viewer = await user('pviewer');
    const stranger = await user('pstranger');
    const team = teamService.create(owner, 'Crew');
    teamService.acceptInvite(admin, teamService.invite(owner, team.id, 'padmin', 'admin').id);
    teamService.acceptInvite(viewer, teamService.invite(owner, team.id, 'pviewer', 'viewer').id);
    const paste = createTestPaste(owner.id, { slug: 'shared' });
    getTestDatabase().prepare('UPDATE pastes SET teamId = ? WHERE id = ?').run(team.id, paste.id);

    const canEditAs = async (who) =>
      (await render(pasteController.view, { params: { slug: 'shared' }, user: who, session: {} }))._viewData.canEdit;
    expect(await canEditAs(owner)).toBe(true);
    expect(await canEditAs(admin)).toBe(true);
    expect(await canEditAs(viewer)).toBe(false);
    expect(await canEditAs(stranger)).toBe(false);
  });
});
