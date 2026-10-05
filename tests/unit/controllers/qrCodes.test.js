const fs = require('fs');
const express = require('express');
const request = require('supertest');
const paths = require('../../../config/paths');
const configService = require('../../../services/configService');
const QRCodeService = require('../../../services/qrcodeService');
const { featureRoutes } = require('../../../middleware/requireFeature');
const {
  createTestUser, createTestUrl, createTestBundle, createTestPaste, createTestFile
} = require('../../setup/testHelpers');

function setSettings(data) {
  fs.writeFileSync(paths.SETTINGS_PATH, JSON.stringify(data));
  configService.reload();
}
afterEach(() => {
  fs.rmSync(paths.SETTINGS_PATH, { force: true });
  configService.reload();
  jest.restoreAllMocks();
});

// Mounted as in app.js
function makeApp() {
  const app = express();
  app.use('/', featureRoutes('qrCodes', require('../../../routes/qrcodeRoutes')));
  app.use((req, res) => res.status(404).json({ notFound: true }));
  return app;
}

let owner, app;
beforeEach(async () => {
  owner = await createTestUser({ username: 'owner' });
  app = makeApp();
});

const MAKE = {
  url: () => createTestUrl({ slug: 'lnk' }),
  bundle: () => createTestBundle({ slug: 'bnd' }),
  paste: () => createTestPaste(owner.id, { slug: 'pst' }),
  file: () => createTestFile(owner.id, { slug: 'fil' })
};
// What each QR code points at: links go through the info page (a safety preview)
const TARGET = { url: '/info/lnk', bundle: '/b/bnd', paste: '/p/pst', file: '/f/fil' };
const SLUG = { url: 'lnk', bundle: 'bnd', paste: 'pst', file: 'fil' };

// One route per format for every type, found by slug: /qrcode/:type/:slug
describe.each(Object.keys(MAKE))('QR codes for a %s', (type) => {
  const encoded = (spy) => spy.mock.calls[0][0];

  it('PNG image of its public address', async () => {
    MAKE[type]();
    const spy = jest.spyOn(QRCodeService, 'generateBuffer');
    const res = await request(app).get(`/qrcode/${type}/${SLUG[type]}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/png/);
    expect(encoded(spy)).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:\\d+${TARGET[type]}$`));
  });

  it('finds the item by its slug in any case', async () => {
    MAKE[type]();
    const spy = jest.spyOn(QRCodeService, 'generateBuffer');
    const res = await request(app).get(`/qrcode/${type}/${SLUG[type].toUpperCase()}`);
    expect(res.status).toBe(200);
    expect(encoded(spy)).toMatch(new RegExp(`${TARGET[type]}$`));
  });

  it('SVG on request', async () => {
    MAKE[type]();
    const res = await request(app).get(`/qrcode/${type}/${SLUG[type]}?format=svg`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/svg\+xml/);
  });

  it('download as an attachment named after the item', async () => {
    MAKE[type]();
    const res = await request(app).get(`/qrcode/${type}/${SLUG[type]}/download`);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toBe(`attachment; filename="qrcode-${type}-${SLUG[type]}.png"`);
  });

  it('data URL as JSON', async () => {
    MAKE[type]();
    const res = await request(app).get(`/api/qrcode/${type}/${SLUG[type]}/dataurl`);
    expect(res.status).toBe(200);
    expect(res.body.dataURL).toMatch(/^data:image\/png;base64,/);
    expect(res.body.target).toMatch(new RegExp(`${TARGET[type]}$`));
  });

  it('404s an unknown slug', async () => {
    expect((await request(app).get(`/qrcode/${type}/nope`)).status).toBe(404);
  });
});

describe('what QR routes do not give away', () => {
  it('404s the old ID-based addresses, so counting IDs reveals no slugs', async () => {
    const url = MAKE.url();
    const bundle = MAKE.bundle();
    for (const path of [
      `/qrcode/${url.id}`, `/qrcode/${url.id}/download`, `/api/qrcode/${url.id}/dataurl`,
      `/qrcode/bundle/${bundle.id}`, `/qrcode/bundle/${bundle.id}/download`
    ]) {
      const res = await request(app).get(path);
      expect({ path, status: res.status }).toEqual({ path, status: 404 });
      expect(res.text).not.toMatch(/lnk|bnd/);
    }
  });

  it('404s an unknown type', async () => {
    MAKE.url();
    expect((await request(app).get('/qrcode/nope/lnk')).status).toBe(404);
  });

  it.each([['paste', 'pastes'], ['file', 'files'], ['bundle', 'bundles']])(
    '404s %s QR codes when that feature is off', async (type, feature) => {
      MAKE[type]();
      setSettings({ features: { [feature]: false } });
      expect((await request(app).get(`/qrcode/${type}/${SLUG[type]}`)).status).toBe(404);
    }
  );

  it('404s every QR code when qrCodes is off', async () => {
    MAKE.url();
    setSettings({ features: { qrCodes: false } });
    expect((await request(app).get('/qrcode/url/lnk')).status).toBe(404);
    expect((await request(app).get('/api/qrcode/url/lnk/dataurl')).status).toBe(404);
  });
});
