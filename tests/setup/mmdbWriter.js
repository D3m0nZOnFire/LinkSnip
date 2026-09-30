const net = require('net');

/**
 * A minimal MaxMind DB (.mmdb) writer for tests: an IPv6 tree (IPv4 lives at ::/96,
 * as in the DB-IP and MaxMind files) with 24-bit records, and the data types a
 * country database uses. Spec: https://maxmind.github.io/MaxMind-DB/
 *
 *   buildMmdb([{ network: '8.8.8.0/24', data: { country: { names: { en: 'United States' } } } }])
 */

const TYPES = { utf8: 2, uint16: 5, uint32: 6, map: 7, uint64: 9, array: 11 };

function control(type, size) {
  const extended = type > 7;
  const bytes = [];
  let sizeBits;
  const sizeBytes = [];
  if (size < 29) sizeBits = size;
  else if (size < 285) { sizeBits = 29; sizeBytes.push(size - 29); }
  else { sizeBits = 30; const n = size - 285; sizeBytes.push(n >> 8, n & 0xff); }
  bytes.push(((extended ? 0 : type) << 5) | sizeBits);
  if (extended) bytes.push(type - 7);
  return Buffer.from([...bytes, ...sizeBytes]);
}

function uintBytes(value) {
  let n = BigInt(value);
  const out = [];
  while (n > 0n) { out.unshift(Number(n & 0xffn)); n >>= 8n; }
  return Buffer.from(out);
}

function encode(value) {
  if (typeof value === 'string') {
    const payload = Buffer.from(value, 'utf8');
    return Buffer.concat([control(TYPES.utf8, payload.length), payload]);
  }
  if (typeof value === 'bigint') {
    const payload = uintBytes(value);
    return Buffer.concat([control(TYPES.uint64, payload.length), payload]);
  }
  if (typeof value === 'number') {
    const payload = uintBytes(value);
    return Buffer.concat([control(TYPES.uint32, payload.length), payload]);
  }
  if (Array.isArray(value)) {
    return Buffer.concat([control(TYPES.array, value.length), ...value.map(encode)]);
  }
  const entries = Object.entries(value);
  return Buffer.concat([control(TYPES.map, entries.length), ...entries.flatMap(([k, v]) => [encode(k), encode(v)])]);
}

const uint16 = (n) => Buffer.concat([control(TYPES.uint16, uintBytes(n).length), uintBytes(n)]);

// The 128 bits of an address, and the prefix length in that 128-bit space
function prefixBits(network) {
  const [address, length] = network.split('/');
  let bytes;
  let bits = Number(length);
  if (net.isIPv4(address)) {
    bytes = [...Array(12).fill(0), ...address.split('.').map(Number)];
    bits += 96;
  } else {
    const [head, tail = ''] = address.split('::');
    const groups = (s) => (s ? s.split(':').map(g => parseInt(g, 16)) : []);
    const h = groups(head);
    const t = groups(tail);
    const all = [...h, ...Array(8 - h.length - t.length).fill(0), ...t];
    bytes = all.flatMap(g => [g >> 8, g & 0xff]);
  }
  const out = [];
  for (let i = 0; i < bits; i++) out.push((bytes[i >> 3] >> (7 - (i & 7))) & 1);
  return out;
}

function buildMmdb(networks, { databaseType = 'DBIP-Country-Lite', buildEpoch = Math.floor(Date.now() / 1000) } = {}) {
  const nodes = [[null, null]];
  const data = [];
  for (const { network, data: record } of networks) {
    const bits = prefixBits(network);
    const dataIndex = data.push(encode(record)) - 1;
    let node = 0;
    bits.forEach((bit, depth) => {
      if (depth === bits.length - 1) {
        nodes[node][bit] = { data: dataIndex };
      } else {
        if (typeof nodes[node][bit] !== 'number') nodes[node][bit] = nodes.push([null, null]) - 1;
        node = nodes[node][bit];
      }
    });
  }

  const nodeCount = nodes.length;
  const offsets = [];
  let offset = 0;
  for (const d of data) { offsets.push(offset); offset += d.length; }
  const recordValue = (r) => {
    if (r === null) return nodeCount;
    if (typeof r === 'number') return r;
    return nodeCount + 16 + offsets[r.data];
  };
  const tree = Buffer.alloc(nodeCount * 6);
  nodes.forEach(([left, right], i) => {
    tree.writeUIntBE(recordValue(left), i * 6, 3);
    tree.writeUIntBE(recordValue(right), i * 6 + 3, 3);
  });

  const metadataMap = Buffer.concat([
    control(TYPES.map, 9),
    encode('node_count'), encode(nodeCount),
    encode('record_size'), uint16(24),
    encode('ip_version'), uint16(6),
    encode('database_type'), encode(databaseType),
    encode('languages'), encode(['en']),
    encode('binary_format_major_version'), uint16(2),
    encode('binary_format_minor_version'), uint16(0),
    encode('build_epoch'), encode(BigInt(buildEpoch)),
    encode('description'), encode({ en: 'LinkSnip test database' })
  ]);

  return Buffer.concat([
    tree, Buffer.alloc(16), ...data,
    Buffer.from('ABCDEF4D61784D696E642E636F6D', 'hex'), metadataMap
  ]);
}

module.exports = { buildMmdb };
