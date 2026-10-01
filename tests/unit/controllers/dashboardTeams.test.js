const fs = require('fs');
const paths = require('../../../config/paths');
const configService = require('../../../services/configService');
const teamService = require('../../../services/teamService');
const DashboardController = require('../../../controllers/dashboardController');
const { createTestUser, createMockRequest, createMockResponse } = require('../../setup/testHelpers');

// The dashboard and teams: pending invites show as a banner.

let alice, bob;
beforeEach(async () => {
  const a = await createTestUser({ username: 'alice', email: 'a@example.com', role: 'trusted' });
  const b = await createTestUser({ username: 'bob', email: 'b@example.com' });
  alice = { id: a.id, username: 'alice', role: 'trusted', isAdmin: 0 };
  bob = { id: b.id, username: 'bob', role: null, isAdmin: 0 };
});

afterEach(() => {
  fs.rmSync(paths.SETTINGS_PATH, { force: true });
  configService.reload();
});

function dashboard(user, query = {}) {
  const res = createMockResponse();
  DashboardController.getUserDashboard(createMockRequest({
    user, session: { userId: user.id, isAdmin: false }, query, protocol: 'http', get: () => 'localhost'
  }), res);
  return res;
}

describe('invite banner', () => {
  it('passes the user\'s pending invites', () => {
    const team = teamService.create(alice, 'Acme');
    const invite = teamService.invite(alice, team.id, 'bob', 'member');

    expect(dashboard(bob)._viewData.teamInvites).toEqual([expect.objectContaining({ id: invite.id, teamName: 'Acme' })]);
    expect(dashboard(alice)._viewData.teamInvites).toEqual([]);
  });

  it('passes none when features.teams is off', () => {
    const team = teamService.create(alice, 'Acme');
    teamService.invite(alice, team.id, 'bob', 'member');
    fs.writeFileSync(paths.SETTINGS_PATH, JSON.stringify({ features: { teams: false } }));
    configService.reload();

    expect(dashboard(bob)._viewData.teamInvites).toEqual([]);
  });
});
