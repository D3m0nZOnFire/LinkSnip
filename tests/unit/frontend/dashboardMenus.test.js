/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "require"]}
 */
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const { viewLocals, appLocals, brandingLocals } = require('../../../middleware/viewLocals');
const DashboardController = require('../../../controllers/dashboardController');
const teamService = require('../../../services/teamService');
const db = require('../../../config/database');
const { createTestUser, createTestUrl, createMockRequest, createMockResponse } = require('../../setup/testHelpers');

// The dashboard's ⋯ row menus (public/js/dashboard.js) close when one of their entries is picked, also the team
// moves handled by public/js/teamMove.js; moving out of a team asks with the app's dialog, never the browser's.

const VIEWS = path.join(__dirname, '../../../views');
const DASHBOARD = fs.readFileSync(path.join(__dirname, '../../../public/js/dashboard.js'), 'utf8');
const TEAM_MOVE = fs.readFileSync(path.join(__dirname, '../../../public/js/teamMove.js'), 'utf8');

let user;
let team;
beforeEach(async () => {
  const u = await createTestUser({ username: 'maker', role: 'trusted' });
  user = { id: u.id, username: 'maker', isAdmin: 0, role: 'trusted' };
  team = teamService.create(user, 'Acme');
  createTestUrl({ slug: 'mine', creatorId: user.id });
  const shared = createTestUrl({ slug: 'shared', creatorId: user.id });
  db.prepare('UPDATE urls SET teamId = ? WHERE id = ?').run(team.id, shared.id);
});

// The scripts listen on document, which outlives a test: remove what each test added
const added = [];
beforeEach(() => {
  const original = document.addEventListener.bind(document);
  jest.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
    added.push([type, listener, options]);
    original(type, listener, options);
  });
});
afterEach(() => {
  added.splice(0).forEach(([type, listener, options]) => document.removeEventListener(type, listener, options));
  jest.restoreAllMocks();
});

async function render(query) {
  const req = createMockRequest({
    user, session: { userId: user.id }, protocol: 'http', query,
    get: (name) => (name.toLowerCase() === 'host' ? 'localhost:8081' : undefined), originalUrl: '/dashboard', path: '/dashboard'
  });
  const res = createMockResponse();
  brandingLocals(req, res, () => {});
  viewLocals(req, res, () => {});
  await DashboardController.getUserDashboard(req, res);
  const html = await ejs.renderFile(path.join(VIEWS, `${res._view}.ejs`), { ...appLocals(), ...res.locals, ...res._viewData });
  document.documentElement.innerHTML = html.replace(/^[\s\S]*?<html[^>]*>/, '').replace(/<\/html>\s*$/, '');
  Object.assign(global, {
    openModal: jest.fn(), closeModal: jest.fn(), showToast: jest.fn(), setButtonLoading: jest.fn(),
    formatDate: () => 'today', confirmAction: jest.fn(async () => false)
  });
  window.confirm = jest.fn(() => false);
  window.alert = jest.fn();
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
  // eslint-disable-next-line no-new-func
  new Function(DASHBOARD)();
  // eslint-disable-next-line no-new-func
  new Function(TEAM_MOVE)();
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const openMenu = () => {
  document.querySelector('.item-row [data-menu-toggle]').click();
  const menu = document.querySelector('.item-row .row-menu .menu');
  expect(menu.hidden).toBe(false);
  return menu;
};

it('closes the menu when "Move to a team" is picked', async () => {
  await render({});
  const menu = openMenu();
  menu.querySelector('[data-move-in]').click();

  expect(global.openModal).toHaveBeenCalledWith('moveToTeamModal');
  expect(menu.hidden).toBe(true);
});

it('closes the menu and asks with the app\'s dialog when "Move out of the team" is picked', async () => {
  await render({ team: String(team.id) });
  const menu = openMenu();
  menu.querySelector('[data-move-out]').click();
  await tick();

  expect(menu.hidden).toBe(true);
  expect(global.confirmAction).toHaveBeenCalledTimes(1);
  expect(window.confirm).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalledWith(expect.stringContaining('/team'), expect.anything()); // answered "no"
});

it('moves the item out once the dialog is confirmed', async () => {
  await render({ team: String(team.id) });
  global.confirmAction.mockResolvedValueOnce(true);
  openMenu().querySelector('[data-move-out]').click();
  await tick();
  await tick();

  expect(global.fetch).toHaveBeenCalledWith(expect.stringMatching(/^\/api\/items\/url\/\d+\/team$/), expect.objectContaining({ method: 'POST', body: JSON.stringify({ teamId: null }) }));
});

it('shows a failed move out as a toast, not a browser alert', async () => {
  await render({ team: String(team.id) });
  global.confirmAction.mockResolvedValueOnce(true);
  global.fetch = jest.fn(async () => ({ ok: false, status: 403, json: async () => ({ success: false, error: 'Not allowed' }) }));
  openMenu().querySelector('[data-move-out]').click();
  await tick();
  await tick();

  expect(window.alert).not.toHaveBeenCalled();
  expect(global.showToast).toHaveBeenCalledWith('Not allowed', 'error');
});
