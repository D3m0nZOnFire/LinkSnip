const fs = require('fs');
const paths = require('../../../config/paths');
const configService = require('../../../services/configService');
const { PERMISSIONS } = require('../../../config/schema');
const { viewLocals, appLocals } = require('../../../middleware/viewLocals');
const { createTestUser, createMockRequest, createMockResponse } = require('../../setup/testHelpers');

afterEach(() => {
  fs.rmSync(paths.SETTINGS_PATH, { force: true });
  configService.reload();
});

function run(user) {
  const req = createMockRequest({ user });
  const res = createMockResponse();
  const next = jest.fn();
  viewLocals(req, res, next);
  expect(next).toHaveBeenCalled();
  return res.locals;
}

describe('appLocals', () => {
  it('carries the version from package.json for the footer', () => {
    expect(appLocals().appVersion).toBe(require('../../../package.json').version);
  });

  it('carries the report reasons for partials/report-modal', () => {
    expect(appLocals().reportReasons).toEqual(require('../../../models/Report').REASONS);
  });
});

describe('viewLocals', () => {
  it('gives every view the feature switches and the registration setting', () => {
    const locals = run(null);
    expect(locals.features).toEqual(configService.getSettings().features);
    expect(locals.registrationOpen).toBe(configService.get('registration.open'));
  });

  it('has an entry in `can` for every permission', () => {
    const locals = run(null);
    expect(Object.keys(locals.can).sort()).toEqual(Object.keys(PERMISSIONS).sort());
    expect(locals.canUploadFiles).toBe(locals.can.uploadFiles);
  });

  it('turns a permission off when its feature is off, admins included', async () => {
    const admin = await createTestUser({ username: 'boss', isAdmin: 1 });
    expect(run(admin).can.createPastes).toBe(true);

    configService.updateSettings({ 'features.pastes': false });
    expect(run(admin).can.createPastes).toBe(false);
  });

  it('gives visitors no writable teams', () => {
    expect(run(null).writableTeams).toEqual([]);
  });
});
