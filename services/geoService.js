const fs = require('fs');
const net = require('net');
const zlib = require('zlib');
const { Reader } = require('mmdb-lib');
const paths = require('../config/paths');
const configService = require('./configService');

/**
 * Visitor countries from a local DB-IP Lite database (DATA_DIR/geo/dbip-country-lite.mmdb,
 * CC BY 4.0: pages that show countries credit "IP Geolocation by DB-IP"). Lookups never
 * leave the server. update() downloads the monthly file from DB-IP; the only thing it
 * sends is the month in the URL. Without the file (offline, download failed), every
 * country is 'Unknown'. An admin can also place the file there by hand.
 */

const SOURCE_URL = (month) => `https://download.db-ip.com/free/dbip-country-lite-${month}.mmdb.gz`;
const DOWNLOAD_TIMEOUT_MS = 120 * 1000;
const RECHECK_MS = 60 * 1000; // how often a lookup notices a replaced or new file

let cache = { reader: null, mtimeMs: null, checkedAt: 0 };

/** @throws {Error} when the buffer is not a country database */
function open(buffer) {
  const reader = new Reader(buffer);
  const type = String(reader.metadata.databaseType || '');
  if (!/country/i.test(type)) throw new Error(`Not a country database: ${type || 'unknown type'}`);
  return reader;
}

function currentReader() {
  const now = Date.now();
  if (cache.checkedAt && now - cache.checkedAt < RECHECK_MS) return cache.reader;
  cache.checkedAt = now;
  let stat;
  try {
    stat = fs.statSync(paths.GEO_DB_PATH);
  } catch (_) {
    cache = { reader: null, mtimeMs: null, checkedAt: now };
    return null;
  }
  if (stat.mtimeMs !== cache.mtimeMs) {
    cache.mtimeMs = stat.mtimeMs;
    try {
      cache.reader = open(fs.readFileSync(paths.GEO_DB_PATH));
    } catch (_) {
      cache.reader = null; // damaged file: countries are Unknown until it is replaced
    }
  }
  return cache.reader;
}

/** Forget the loaded file, so the next lookup reads it again. */
function reload() {
  cache = { reader: null, mtimeMs: null, checkedAt: 0 };
}

// '::ffff:1.2.3.4' (how Node reports IPv4 clients on a dual-stack socket) → '1.2.3.4'
function normalize(ip) {
  if (!ip) return null;
  let address = String(ip).trim();
  const mapped = address.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped) address = mapped[1];
  return net.isIP(address) ? address : null;
}

// Countries are part of analytics: off with either switch
const enabled = () => configService.get('geo.enabled') && configService.get('features.analytics');

/**
 * @param {string} ip
 * @returns {string} English country name, or 'Unknown' (no file, private or unlisted
 *   address, geo.enabled or features.analytics off)
 */
function lookupCountry(ip) {
  if (!enabled()) return 'Unknown';
  const address = normalize(ip);
  if (!address) return 'Unknown';
  const reader = currentReader();
  if (!reader) return 'Unknown';
  try {
    const record = reader.get(address);
    return (record && record.country && record.country.names && record.country.names.en) || 'Unknown';
  } catch (_) {
    return 'Unknown';
  }
}

const monthOf = (date) => date.toISOString().slice(0, 7);
const previousMonth = (date) => monthOf(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1)));

function installedMonth() {
  try {
    return monthOf(open(fs.readFileSync(paths.GEO_DB_PATH)).metadata.buildEpoch);
  } catch (_) {
    return null;
  }
}

/**
 * Download this month's DB-IP file (last month's early in the month, before the new one
 * is out) unless the installed one is as recent. Replaces the file atomically, only
 * with a valid country database. Never throws.
 * @returns {Promise<{ status: 'updated'|'current'|'disabled'|'failed', month?: string, error?: string }>}
 */
async function update({ fetch = globalThis.fetch, now = new Date() } = {}) {
  if (!enabled()) return { status: 'disabled' };
  const installed = installedMonth();
  const temp = `${paths.GEO_DB_PATH}.download`;
  try {
    for (const month of [monthOf(now), previousMonth(now)]) {
      if (installed && installed >= month) return { status: 'current', month: installed };
      const res = await fetch(SOURCE_URL(month), { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
      if (res.status === 404) continue;
      if (!res.ok) throw new Error(`DB-IP answered ${res.status}`);
      const buffer = zlib.gunzipSync(Buffer.from(await res.arrayBuffer()));
      open(buffer);
      fs.mkdirSync(paths.GEO_DIR, { recursive: true });
      fs.writeFileSync(temp, buffer);
      fs.renameSync(temp, paths.GEO_DB_PATH);
      reload();
      return { status: 'updated', month };
    }
    return { status: 'failed', error: 'DB-IP has no file for this month or last month' };
  } catch (error) {
    fs.rmSync(temp, { force: true });
    return { status: 'failed', error: error.message };
  }
}

module.exports = { lookupCountry, update, reload };
