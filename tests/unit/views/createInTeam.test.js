const path = require('path');
const ejs = require('ejs');

// The create page offers "Create in: Personal / <team>" when the user can create in a team.

const VIEW = path.join(__dirname, '../../../views/index.ejs');
const render = (locals) => ejs.renderFile(VIEW, {
  user: { id: 1, username: 'alice', isAdmin: 0 },
  prefillUrl: '', error: null, success: null,
  features: { pastes: true, bundles: true, files: true, qrCodes: true, teams: true },
  can: { createUrls: true, createPastes: true, createBundles: true, uploadFiles: true, tags: true, passwordProtection: true, scheduling: true },
  canUploadFiles: true, registrationOpen: true,
  ...locals
});

it('lists Personal and the writable teams, preselecting ?team', async () => {
  const html = await render({ writableTeams: [{ id: 3, name: 'Acme', role: 'member' }, { id: 4, name: 'Beta', role: 'owner' }], selectedTeamId: 4 });
  expect(html).toMatch(/<select[^>]*name="teamId"[^>]*id="createInTeam"|<select[^>]*id="createInTeam"[^>]*name="teamId"/);
  expect(html).toMatch(/<option value="">Personal<\/option>/);
  expect(html).toContain('<option value="3">Acme</option>');
  expect(html).toContain('<option value="4" selected>Beta</option>');
});

it('is absent without teams', async () => {
  expect(await render({ writableTeams: [] })).not.toContain('id="createInTeam"');
  expect(await render({})).not.toContain('id="createInTeam"');
});

it('sends the team with pastes, bundles and files too', () => {
  // Links post the form (the select is a form field); the other types are sent by public/js/create.js
  const script = require('fs').readFileSync(path.join(__dirname, '../../../public/js/create.js'), 'utf8');
  const sends = (fn) => script.slice(script.indexOf(`function ${fn}(`), script.indexOf('\n  }\n', script.indexOf(`function ${fn}(`)));
  expect(sends('submitPaste')).toContain('body.teamId = teamId()');
  expect(sends('submitBundle')).toContain('body.teamId = teamId()');
  expect(sends('submitFile')).toContain("data.append('teamId', teamId())");
});
