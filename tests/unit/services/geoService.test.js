const fs = require('fs');
const zlib = require('zlib');
const paths = require('../../../config/paths');
const configService = require('../../../services/configService');
const geo = require('../../../services/geoService');
const { buildMmdb } = require('../../setup/mmdbWriter');

// Countries come from a local DB-IP Lite database in DATA_DIR/geo: no visitor IP
// leaves the server. The file is downloaded (and refreshed monthly) from DB-IP.

const US = { country: { iso_code: 'US', names: { en: 'United States' } } };
const PT = { country: { iso_code: 'PT', names: { en: 'Portugal' } } };
const NETWORKS = [
  { network: '8.8.8.0/24', data: US },
  { network: '172.217.0.0/16', data: US }, // public, although it starts with 172.
  { network: '2001:db8::/32', data: PT }
];
const epoch = (iso) => Math.floor(new Date(iso).getTime() / 1000);
const SEPT = epoch('2026-09-01T06:00:00Z');
const AUG = epoch('2026-08-01T06:00:00Z');

function installDb(buffer = buildMmdb(NETWORKS, { buildEpoch: SEPT })) {
  fs.mkdirSync(paths.GEO_DIR, { recursive: true });
  fs.writeFileSync(paths.GEO_DB_PATH, buffer);
  geo.reload();
}
function setGeo(enabled) {
  fs.writeFileSync(paths.SETTINGS_PATH, JSON.stringify({ geo: { enabled } }));
  configService.reload();
}

// A fake DB-IP: serves the given months as .mmdb.gz, 404 for the rest
function fakeDbIp(files) {
  return jest.fn(async (url) => {
    const month = (url.match(/dbip-country-lite-(\d{4}-\d{2})\.mmdb\.gz$/) || [])[1];
    const body = files[month];
    if (!body) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    const gz = zlib.gzipSync(body);
    return { ok: true, status: 200, arrayBuffer: async () => gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.length) };
  });
}

beforeEach(() => {
  global.fetch = jest.fn(() => { throw new Error('no network in tests'); });
});
afterEach(() => {
  fs.rmSync(paths.GEO_DIR, { recursive: true, force: true });
  fs.rmSync(paths.SETTINGS_PATH, { force: true });
  configService.reload();
  geo.reload();
});

describe('lookupCountry', () => {
  it('finds IPv4 and IPv6 addresses in the local database', () => {
    installDb();
    expect(geo.lookupCountry('8.8.8.8')).toBe('United States');
    expect(geo.lookupCountry('2001:db8::1')).toBe('Portugal');
  });

  it('reads IPv4-mapped IPv6 addresses (how Node reports IPv4 clients) as IPv4', () => {
    installDb();
    expect(geo.lookupCountry('::ffff:8.8.8.8')).toBe('United States');
  });

  it('looks up public 172.x addresses (only 172.16.0.0/12 is private)', () => {
    installDb();
    expect(geo.lookupCountry('172.217.3.4')).toBe('United States');
  });

  it.each([
    ['127.0.0.1'], ['::1'], ['10.0.0.1'], ['192.168.1.1'], ['172.16.0.1'], ['9.9.9.9'],
    [null], [''], ['unknown'], ['not an ip']
  ])('answers Unknown for %p', (ip) => {
    installDb();
    expect(geo.lookupCountry(ip)).toBe('Unknown');
  });

  it('answers Unknown without a database file', () => {
    expect(geo.lookupCountry('8.8.8.8')).toBe('Unknown');
  });

  it('answers Unknown for a damaged file instead of failing the visit', () => {
    installDb(Buffer.from('not a database'));
    expect(geo.lookupCountry('8.8.8.8')).toBe('Unknown');
  });

  it('answers Unknown when geo.enabled is off', () => {
    installDb();
    setGeo(false);
    expect(geo.lookupCountry('8.8.8.8')).toBe('Unknown');
  });

  it('never contacts anyone', () => {
    installDb();
    geo.lookupCountry('8.8.8.8');
    geo.lookupCountry('9.9.9.9');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('update', () => {
  const now = new Date('2026-09-15T12:00:00Z');

  it("downloads this month's file and uses it right away", async () => {
    const fetch = fakeDbIp({ '2026-09': buildMmdb(NETWORKS, { buildEpoch: SEPT }) });

    const result = await geo.update({ fetch, now });

    expect(result).toEqual(expect.objectContaining({ status: 'updated', month: '2026-09' }));
    expect(fetch).toHaveBeenCalledWith('https://download.db-ip.com/free/dbip-country-lite-2026-09.mmdb.gz', expect.any(Object));
    expect(geo.lookupCountry('8.8.8.8')).toBe('United States');
  });

  it("falls back to last month's file early in the month, before the new one is out", async () => {
    const fetch = fakeDbIp({ '2026-08': buildMmdb(NETWORKS, { buildEpoch: AUG }) });

    const result = await geo.update({ fetch, now: new Date('2026-09-01T02:00:00Z') });

    expect(result).toEqual(expect.objectContaining({ status: 'updated', month: '2026-08' }));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('downloads nothing while the file is from this month', async () => {
    installDb();
    const fetch = fakeDbIp({});

    expect(await geo.update({ fetch, now })).toEqual(expect.objectContaining({ status: 'current' }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps last month's file when this month's is not out yet", async () => {
    installDb(buildMmdb(NETWORKS, { buildEpoch: AUG }));
    const fetch = fakeDbIp({ '2026-08': buildMmdb(NETWORKS, { buildEpoch: AUG }) });

    expect(await geo.update({ fetch, now })).toEqual(expect.objectContaining({ status: 'current' }));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('replaces an older file', async () => {
    installDb(buildMmdb([{ network: '8.8.8.0/24', data: PT }], { buildEpoch: AUG }));
    const fetch = fakeDbIp({ '2026-09': buildMmdb(NETWORKS, { buildEpoch: SEPT }) });

    expect(await geo.update({ fetch, now })).toEqual(expect.objectContaining({ status: 'updated' }));
    expect(geo.lookupCountry('8.8.8.8')).toBe('United States');
  });

  it('refuses a download that is not a country database, and keeps the old file', async () => {
    installDb(buildMmdb(NETWORKS, { buildEpoch: AUG }));
    const fetch = fakeDbIp({ '2026-09': Buffer.from('<html>blocked by proxy</html>') });

    const result = await geo.update({ fetch, now });

    expect(result).toEqual(expect.objectContaining({ status: 'failed', error: expect.any(String) }));
    expect(geo.lookupCountry('8.8.8.8')).toBe('United States');
    expect(fs.readdirSync(paths.GEO_DIR)).toEqual(['dbip-country-lite.mmdb']); // no temp file left
  });

  it('refuses a city or ASN database', async () => {
    const fetch = fakeDbIp({ '2026-09': buildMmdb(NETWORKS, { databaseType: 'DBIP-ASN-Lite', buildEpoch: SEPT }) });
    expect(await geo.update({ fetch, now })).toEqual(expect.objectContaining({ status: 'failed' }));
    expect(fs.existsSync(paths.GEO_DB_PATH)).toBe(false);
  });

  it('reports a network failure without throwing', async () => {
    const fetch = jest.fn(async () => { throw new Error('ECONNREFUSED'); });
    expect(await geo.update({ fetch, now })).toEqual(expect.objectContaining({ status: 'failed', error: expect.stringMatching(/ECONNREFUSED/) }));
  });

  it('does nothing while geo.enabled is off', async () => {
    setGeo(false);
    const fetch = fakeDbIp({ '2026-09': buildMmdb(NETWORKS, { buildEpoch: SEPT }) });

    expect(await geo.update({ fetch, now })).toEqual({ status: 'disabled' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
