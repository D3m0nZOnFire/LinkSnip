const fs = require('fs');
const paths = require('../../../config/paths');
const configService = require('../../../services/configService');
const { requireFeature, featureRoutes } = require('../../../middleware/requireFeature');

function setFeatures(features) {
  fs.writeFileSync(paths.SETTINGS_PATH, JSON.stringify({ features }));
  configService.reload();
}

afterEach(() => {
  fs.rmSync(paths.SETTINGS_PATH, { force: true });
  configService.reload();
});

describe('requireFeature', () => {
  it('passes through when the feature is on', () => {
    const next = jest.fn();
    requireFeature('pastes')({}, {}, next);
    expect(next).toHaveBeenCalledWith();
  });

  it("skips the route (falls through to the 404) when the feature is off", () => {
    setFeatures({ pastes: false });
    const next = jest.fn();
    requireFeature('pastes')({}, {}, next);
    expect(next).toHaveBeenCalledWith('route');
  });

  it('reads the switch live', () => {
    const mw = requireFeature('bundles');
    const next = jest.fn();

    setFeatures({ bundles: false });
    mw({}, {}, next);
    setFeatures({ bundles: true });
    mw({}, {}, next);

    expect(next.mock.calls).toEqual([['route'], []]);
  });

  it('throws at setup time for an unknown feature', () => {
    expect(() => requireFeature('teleport')).toThrow(/Unknown feature/);
  });
});

describe('featureRoutes', () => {
  it('hands the request to the router when the feature is on', () => {
    const router = jest.fn();
    const next = jest.fn();
    featureRoutes('files', router)({}, {}, next);
    expect(router).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('skips the whole router when the feature is off', () => {
    setFeatures({ files: false });
    const router = jest.fn();
    const next = jest.fn();
    featureRoutes('files', router)({}, {}, next);
    expect(router).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });

  it('throws at setup time for an unknown feature', () => {
    expect(() => featureRoutes('teleport', jest.fn())).toThrow(/Unknown feature/);
  });
});
