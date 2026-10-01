const fs = require('fs');
const path = require('path');
const paths = require('../../../config/paths');
const configService = require('../../../services/configService');
const paletteService = require('../../../services/paletteService');
const brandingService = require('../../../services/brandingService');
const { BrandingError } = brandingService;

// Smallest files each type is recognised by (their magic bytes)
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(8)]);
const ICO = Buffer.concat([Buffer.from([0x00, 0x00, 0x01, 0x00]), Buffer.alloc(16)]);
const SVG = Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>');

afterEach(() => {
  fs.rmSync(paths.BRANDING_DIR, { recursive: true, force: true });
  fs.rmSync(paths.SETTINGS_PATH, { force: true });
  configService.reload();
});

describe('saveAsset', () => {
  it.each([['png', PNG], ['jpg', JPEG], ['webp', WEBP], ['svg', SVG]])('stores a %s logo as DATA_DIR/branding/logo.%s', (ext, data) => {
    const saved = brandingService.saveAsset('logo', data);
    expect(saved).toMatchObject({ type: ext, size: data.length });
    expect(fs.readFileSync(path.join(paths.BRANDING_DIR, `logo.${ext}`))).toEqual(data);
  });

  it('takes an ICO file as favicon, but not as logo', () => {
    expect(brandingService.saveAsset('favicon', ICO).type).toBe('ico');
    expect(() => brandingService.saveAsset('logo', ICO)).toThrow(BrandingError);
  });

  it('replaces the previous file, whatever its type', () => {
    brandingService.saveAsset('logo', PNG);
    brandingService.saveAsset('logo', SVG);
    expect(fs.readdirSync(paths.BRANDING_DIR)).toEqual(['logo.svg']);
  });

  it('judges a file by its content, not its name', () => {
    expect(() => brandingService.saveAsset('logo', Buffer.from('<html><body>hi</body></html>'))).toThrow(/PNG, JPG, WebP or SVG/);
  });

  it('refuses an SVG with scripts or event handlers', () => {
    for (const bad of [
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><rect/></a></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div/></foreignObject></svg>'
    ]) {
      expect(() => brandingService.saveAsset('logo', Buffer.from(bad))).toThrow(/scripts/);
    }
  });

  it('refuses files over 1 MB', () => {
    const big = Buffer.concat([PNG, Buffer.alloc(brandingService.MAX_BYTES)]);
    expect(() => brandingService.saveAsset('logo', big)).toThrow(/1 MB/);
  });

  it('refuses an unknown asset name', () => {
    expect(() => brandingService.saveAsset('../settings', PNG)).toThrow(BrandingError);
  });

  it('answers 400 for a bad file', () => {
    try {
      brandingService.saveAsset('logo', Buffer.from('nope'));
    } catch (error) {
      expect(error.status).toBe(400);
    }
    expect.assertions(1);
  });
});

describe('assetFile / deleteAsset', () => {
  it('finds the stored file with its content type', () => {
    expect(brandingService.assetFile('logo')).toBeNull();
    brandingService.saveAsset('logo', SVG);
    expect(brandingService.assetFile('logo')).toMatchObject({
      path: path.join(paths.BRANDING_DIR, 'logo.svg'),
      contentType: 'image/svg+xml'
    });
  });

  it('removes it, going back to the default', () => {
    brandingService.saveAsset('favicon', ICO);
    expect(brandingService.deleteAsset('favicon')).toBe(true);
    expect(brandingService.assetFile('favicon')).toBeNull();
    expect(brandingService.deleteAsset('favicon')).toBe(false);
  });
});

describe('locals (every view)', () => {
  it('has the name and tagline from settings.json', () => {
    configService.updateSettings({ 'branding.name': 'Snipz', 'branding.tagline': 'Tiny links.' });
    expect(brandingService.locals()).toMatchObject({ name: 'Snipz', tagline: 'Tiny links.' });
  });

  it('trims the name and tagline', () => {
    configService.updateSettings({ 'branding.name': '  Snipz ', 'branding.tagline': ' Tiny. ' });
    expect(brandingService.locals()).toMatchObject({ name: 'Snipz', tagline: 'Tiny.' });
  });

  it("uses LinkSnip's logo for both until others are uploaded", () => {
    expect(brandingService.locals()).toMatchObject({ logoUrl: '/logo.png', faviconUrl: '/logo.png' });
  });

  it('points at the uploaded files, versioned so browsers fetch a new one', () => {
    brandingService.saveAsset('logo', PNG);
    const { logoUrl, faviconUrl } = brandingService.locals();
    expect(logoUrl).toMatch(/^\/branding\/logo\?v=\d+$/);
    expect(faviconUrl).toBe(logoUrl); // no favicon of its own: the logo
    brandingService.saveAsset('favicon', ICO);
    expect(brandingService.locals().faviconUrl).toMatch(/^\/branding\/favicon\?v=\d+$/);
  });

  it('links the theme stylesheet by its hash', () => {
    expect(brandingService.locals().themeUrl).toBe(`/theme.css?v=${paletteService.themeCss().hash}`);
  });
});
