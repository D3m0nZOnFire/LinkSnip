/**
 * @jest-environment jsdom
 */
const fs = require('fs');
const path = require('path');

// Admin → Teams (public/js/admin-teams.js): Delete opens a dialog where the team's exact name has to be typed
// (not the browser's prompt()); only then can it be sent.

const SCRIPT = fs.readFileSync(path.join(__dirname, '../../../public/js/admin-teams.js'), 'utf8');

let location;

function setup() {
  document.body.innerHTML = `
    <button class="delete-team" data-team-id="7" data-team-name="Events crew" data-team-items="1 link">Delete</button>
    <div id="deleteTeamModal">
      <h3 id="deleteTeamTitle"></h3>
      <form id="deleteTeamForm">
        <p><strong id="deleteTeamItems"></strong></p>
        <input id="confirmTeamName">
        <p id="deleteTeamError"></p>
      </form>
      <button type="submit" form="deleteTeamForm" id="confirmDeleteTeamBtn">Delete team</button>
    </div>`;
  Object.assign(global, {
    openModal: jest.fn(), closeModal: jest.fn(), showToast: jest.fn(),
    apiRequest: jest.fn().mockResolvedValue({ success: true })
  });
  window.prompt = jest.fn();
  // jsdom can't navigate: the script gets a stand-in location, so a reload is recorded instead
  location = { href: '/admin/teams', reload: jest.fn() };
  // eslint-disable-next-line no-new-func
  new Function('window', SCRIPT)({ location });
}

const $ = (id) => document.getElementById(id);
const type = (value) => {
  $('confirmTeamName').value = value;
  $('confirmTeamName').dispatchEvent(new Event('input'));
};

it('opens the dialog for that team, with the button off until the name is typed exactly', () => {
  setup();
  document.querySelector('.delete-team').click();

  expect(window.prompt).not.toHaveBeenCalled();
  expect(global.openModal).toHaveBeenCalledWith('deleteTeamModal');
  expect($('deleteTeamTitle').textContent).toBe('Delete Events crew');
  expect($('deleteTeamItems').textContent).toBe('1 link');
  expect($('confirmDeleteTeamBtn').disabled).toBe(true);

  type('events crew');
  expect($('confirmDeleteTeamBtn').disabled).toBe(true);
  type('Events crew');
  expect($('confirmDeleteTeamBtn').disabled).toBe(false);
});

it('sends the typed name with the delete', async () => {
  setup();
  document.querySelector('.delete-team').click();
  type('Events crew');
  $('deleteTeamForm').dispatchEvent(new Event('submit', { cancelable: true }));
  await new Promise(resolve => setTimeout(resolve, 0));

  expect(global.apiRequest).toHaveBeenCalledWith('/api/teams/7', { method: 'DELETE', body: JSON.stringify({ confirmName: 'Events crew' }) });
  expect(location.reload).toHaveBeenCalled();
});
