/**
 * @jest-environment jsdom
 */
const fs = require('fs');
const path = require('path');

// The dashboard's team invite banner (views/partials/team-invites.ejs): Accept opens the team, Decline reloads,
// an error is shown and the button works again.

const SCRIPT = fs.readFileSync(path.join(__dirname, '../../../public/js/team-invites.js'), 'utf8');

function setup(answer) {
  document.body.innerHTML = `
    <div class="team-invite">
      <button data-invite-id="9" data-action="accept">Accept</button>
      <button data-invite-id="9" data-action="decline">Decline</button>
    </div>`;
  global.fetch = jest.fn().mockResolvedValue({ json: () => Promise.resolve(answer) });
  window.alert = jest.fn();
  const go = { href: null, reload: jest.fn() };
  // eslint-disable-next-line no-new-func
  new Function('window', SCRIPT)({ alert: window.alert, location: go });
  return go;
}

const click = async (action) => {
  document.querySelector(`[data-action="${action}"]`).click();
  await new Promise(resolve => setTimeout(resolve, 0));
};

it('accepting posts the invite and opens the team', async () => {
  const go = setup({ success: true, teamId: 5 });
  await click('accept');
  expect(fetch).toHaveBeenCalledWith('/api/team-invites/9/accept', { method: 'POST' });
  expect(go.href).toBe('/teams/5');
});

it('declining posts the invite and reloads', async () => {
  const go = setup({ success: true });
  await click('decline');
  expect(fetch).toHaveBeenCalledWith('/api/team-invites/9/decline', { method: 'POST' });
  expect(go.reload).toHaveBeenCalled();
});

it('an error is shown and the button can be used again', async () => {
  setup({ success: false, error: 'Invite not found.' });
  await click('accept');
  expect(window.alert).toHaveBeenCalledWith('Invite not found.');
  expect(document.querySelector('[data-action="accept"]').disabled).toBe(false);
});
