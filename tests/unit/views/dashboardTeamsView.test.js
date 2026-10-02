const path = require('path');
const ejs = require('ejs');
const configService = require('../../../services/configService');
const teamService = require('../../../services/teamService');
const DashboardController = require('../../../controllers/dashboardController');
const { getTestDatabase } = require('../../setup/testDatabase');
const { createTestUser, createTestUrl, createTestPaste, createMockRequest, createMockResponse } = require('../../setup/testHelpers');

// The dashboard template with teams: switcher, per-row actions, moving.

const VIEW = path.join(__dirname, '../../../views/dashboard.ejs');
let owner, member, viewer, team, ours, theirs, mine;

beforeEach(async () => {
  const user = async (name, extra = {}) => {
    const row = await createTestUser({ username: name, email: `${name}@example.com`, ...extra });
    return { id: row.id, username: name, isAdmin: 0, role: row.role };
  };
  owner = await user('owner', { role: 'trusted' });
  member = await user('member', { role: 'trusted' });
  viewer = await user('viewer');
  team = teamService.create(owner, 'Acme');
  teamService.acceptInvite(member, teamService.invite(owner, team.id, 'member', 'member').id);
  teamService.acceptInvite(viewer, teamService.invite(owner, team.id, 'viewer', 'viewer').id);

  ours = createTestUrl({ slug: 'ours', creatorId: member.id });
  theirs = createTestUrl({ slug: 'theirs', creatorId: owner.id });
  mine = createTestUrl({ slug: 'mine', creatorId: member.id });
  const db = getTestDatabase();
  for (const id of [ours.id, theirs.id]) db.prepare('UPDATE urls SET teamId = ? WHERE id = ?').run(team.id, id);
  db.prepare('UPDATE pastes SET teamId = ? WHERE id = ?').run(team.id, createTestPaste(owner.id, { slug: 'tp' }).id);
});

function page(user, query = {}) {
  const res = createMockResponse();
  DashboardController.getUserDashboard(createMockRequest({
    user, session: { userId: user.id, isAdmin: false }, query, protocol: 'http', get: () => 'localhost'
  }), res);
  const features = configService.getSettings().features;
  return ejs.renderFile(VIEW, {
    views: [path.join(__dirname, '../../../views')],
    ...res._viewData,
    features,
    can: { analytics: true, tags: true, createPastes: true, createBundles: true, analyticsShareLinks: true }
  });
}

// The markup of one row (rows carry data-type and data-id)
function row(html, type, id) {
  const chunk = html.split('class="item-row').find(part => part.includes(`data-type="${type}" data-id="${id}"`));
  return chunk || '';
}

describe('team dashboard', () => {
  it('names the team and lets members switch back to personal', async () => {
    const html = await page(member, { team: team.id });
    expect(html).toContain('Acme');
    expect(html).toMatch(/<select[^>]*id="dashboardScope"/);
    expect(html).toMatch(/<option value=""[^>]*>Personal<\/option>/);
    expect(html).toMatch(new RegExp(`<option value="${team.id}" selected`));
  });

  it('shows Edit and Delete only on rows the user may change', async () => {
    const html = await page(member, { team: team.id });
    expect(row(html, 'url', ours.id)).toContain('data-action="edit"');
    expect(row(html, 'url', ours.id)).toContain('data-action="delete"');
    expect(row(html, 'url', theirs.id)).not.toBe('');
    expect(row(html, 'url', theirs.id)).not.toContain('data-action="edit"');
    expect(row(html, 'url', theirs.id)).not.toContain('data-action="delete"');
  });

  it('shows who created each team item', async () => {
    const html = await page(member, { team: team.id });
    expect(html).toMatch(/by\s*<strong>owner<\/strong>/);
  });

  it('viewers get no edit, delete or select', async () => {
    const html = await page(viewer, { team: team.id });
    expect(html).toContain('class="item-row');
    expect(html).not.toContain('data-action="edit"');
    expect(html).not.toContain('data-action="delete"');
    expect(html).not.toContain('id="selectModeBtn"');
  });

  it('owners can move items out of the team', async () => {
    const html = await page(owner, { team: team.id });
    expect(html).toMatch(new RegExp(`data-move-out[^>]*data-type="url"[^>]*data-id="${ours.id}"|data-type="url"[^>]*data-id="${ours.id}"[^>]*data-move-out`));
  });

  it('keeps the team when filtering and links "Create New" to it', async () => {
    const html = await page(member, { team: team.id });
    expect(html).toMatch(new RegExp(`<input type="hidden" name="team" value="${team.id}">`));
    expect(html).toContain(`href="/?team=${team.id}"`);
  });
});

describe('personal dashboard', () => {
  it('offers moving own items into a team', async () => {
    const html = await page(member);
    expect(html).toMatch(new RegExp(`data-move-in[^>]*data-type="url"[^>]*data-id="${mine.id}"|data-type="url"[^>]*data-id="${mine.id}"[^>]*data-move-in`));
    expect(html).toContain('id="moveToTeamModal"');
    expect(row(html, 'url', ours.id)).toBe('');
  });

  it('has no switcher or move without teams', async () => {
    const loner = { id: (await createTestUser({ username: 'loner', email: 'l@example.com' })).id, username: 'loner', isAdmin: 0 };
    const html = await page(loner);
    expect(html).not.toContain('id="dashboardScope"');
    expect(html).not.toContain('data-move-in');
  });
});
