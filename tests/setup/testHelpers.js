const bcrypt = require('bcrypt');
const { getTestDatabase } = require('./testDatabase');

/**
 * Create a test user with bcrypt-hashed password
 * @param {object} overrides - Override default user values
 * @returns {object} Created user object
 */
async function createTestUser(overrides = {}) {
  const db = getTestDatabase();

  const defaults = {
    username: `testuser_${Date.now()}`,
    email: `test_${Date.now()}@example.com`,
    password: 'password123',
    isAdmin: 0,
    isBanned: 0,
    role: null
  };

  const userData = { ...defaults, ...overrides };
  const hashedPassword = await bcrypt.hash(userData.password, 10);

  const stmt = db.prepare(`
    INSERT INTO users (username, email, password, isAdmin, isBanned, role)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    userData.username,
    userData.email,
    hashedPassword,
    userData.isAdmin,
    userData.isBanned,
    userData.role
  );

  return {
    id: result.lastInsertRowid,
    username: userData.username,
    email: userData.email,
    isAdmin: userData.isAdmin,
    isBanned: userData.isBanned,
    role: userData.role,
    // Store plain password for tests that need to verify
    plainPassword: userData.password
  };
}

/**
 * Create a test URL
 * @param {object} overrides - Override default URL values
 * @returns {object} Created URL object
 */
function createTestUrl(overrides = {}) {
  const db = getTestDatabase();

  const defaults = {
    slug: `test${Date.now()}`,
    longUrl: 'https://example.com',
    creatorId: null,
    clicks: 0,
    maxUses: null,
    expiresAt: null,
    isBlocked: 0,
    isQuarantined: 0,
    password: null,
    activateAt: null,
    deactivateAt: null
  };

  const urlData = { ...defaults, ...overrides };

  const stmt = db.prepare(`
    INSERT INTO urls (slug, longUrl, creatorId, clicks, maxUses, expiresAt, isBlocked, isQuarantined, password, activateAt, deactivateAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    urlData.slug,
    urlData.longUrl,
    urlData.creatorId,
    urlData.clicks,
    urlData.maxUses,
    urlData.expiresAt,
    urlData.isBlocked,
    urlData.isQuarantined,
    urlData.password,
    urlData.activateAt,
    urlData.deactivateAt
  );

  return {
    id: result.lastInsertRowid,
    ...urlData
  };
}

/**
 * Create a test tag
 * @param {object} overrides - Override default tag values
 * @returns {object} Created tag object
 */
function createTestTag(overrides = {}) {
  const db = getTestDatabase();

  const defaults = {
    name: `tag_${Date.now()}`,
    color: '#34d399',
    userId: null
  };

  const tagData = { ...defaults, ...overrides };

  const stmt = db.prepare(`
    INSERT INTO tags (name, color, userId)
    VALUES (?, ?, ?)
  `);

  const result = stmt.run(
    tagData.name,
    tagData.color,
    tagData.userId
  );

  return {
    id: result.lastInsertRowid,
    ...tagData
  };
}

/**
 * Create a mock Express request object
 * @param {object} overrides - Override default request values
 * @returns {object} Mock request object
 */
function createMockRequest(overrides = {}) {
  return {
    session: {},
    user: null,
    params: {},
    query: {},
    body: {},
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/91.0.4472.124',
      'x-forwarded-for': null,
      'referer': null
    },
    ip: '127.0.0.1',
    connection: { remoteAddress: '127.0.0.1' },
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides
  };
}

/**
 * Create a mock Express response object
 * @returns {object} Mock response object with jest spies
 */
function createMockResponse() {
  const res = {
    statusCode: 200,
    _redirectUrl: null,
    _jsonData: null,
    _sentData: null
  };

  res.status = jest.fn((code) => {
    res.statusCode = code;
    return res;
  });

  res.redirect = jest.fn((url) => {
    res._redirectUrl = url;
    return res;
  });

  res.json = jest.fn((data) => {
    res._jsonData = data;
    return res;
  });

  res.send = jest.fn((data) => {
    res._sentData = data;
    return res;
  });

  res.render = jest.fn((view, data) => {
    res._view = view;
    res._viewData = data;
    return res;
  });

  res.locals = {};

  return res;
}

/**
 * Create a mock next function for middleware testing
 * @returns {jest.Mock} Mock next function
 */
function createMockNext() {
  return jest.fn();
}

/**
 * Put a tag on an item of any content type
 * @param {'url'|'bundle'|'paste'|'file'} type
 * @param {number} id - Item ID
 * @param {number} tagId - Tag ID
 */
function tagItem(type, id, tagId) {
  getTestDatabase().prepare('INSERT INTO taggables (tagId, targetType, targetId) VALUES (?, ?, ?)').run(tagId, type, id);
}

let reportCounter = 0;

/**
 * Create a test report (reports table). `urlId` is a shortcut for targetType 'url'.
 * Each report gets its own reporter hash unless one is given (one report per reporter per item).
 * @param {object} overrides - Override default report values
 * @returns {object} Created report object
 */
function createTestReport(overrides = {}) {
  const db = getTestDatabase();
  const { urlId, ...rest } = overrides;

  const reportData = {
    targetType: 'url',
    targetId: urlId !== undefined ? urlId : null,
    reporterIpHash: `testhash${++reportCounter}`,
    reason: 'SPAM',
    description: 'Test report description',
    status: 'pending',
    ...rest
  };

  const result = db.prepare(`
    INSERT INTO reports (targetType, targetId, reporterIpHash, reason, description, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    reportData.targetType,
    reportData.targetId,
    reportData.reporterIpHash,
    reportData.reason,
    reportData.description,
    reportData.status
  );

  return { id: result.lastInsertRowid, ...reportData };
}

/**
 * Create a test bundle
 * @param {object} overrides - Override default bundle values
 * @returns {object} Created bundle object
 */
function createTestBundle(overrides = {}) {
  const db = getTestDatabase();

  const defaults = {
    slug: `bundle${Date.now()}`,
    title: 'Test Bundle',
    description: null,
    creatorId: null,
    clicks: 0,
    maxUses: null,
    expiresAt: null,
    isBlocked: 0,
    isQuarantined: 0,
    password: null,
    activateAt: null,
    deactivateAt: null
  };

  const data = { ...defaults, ...overrides };

  const result = db.prepare(`
    INSERT INTO bundles (slug, title, description, creatorId, clicks, maxUses, expiresAt, isBlocked, isQuarantined, password, activateAt, deactivateAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(data.slug, data.title, data.description, data.creatorId, data.clicks, data.maxUses, data.expiresAt, data.isBlocked, data.isQuarantined, data.password, data.activateAt, data.deactivateAt);

  return { id: result.lastInsertRowid, ...data };
}

/**
 * Create a test bundle item
 * @param {number} bundleId - Bundle ID to attach to
 * @param {object} overrides - Override default values
 * @returns {object} Created bundle item object
 */
function createTestBundleItem(bundleId, overrides = {}) {
  const db = getTestDatabase();

  const defaults = {
    url: 'https://example.com',
    label: null,
    position: 0
  };

  const data = { ...defaults, ...overrides };

  const result = db.prepare(`
    INSERT INTO bundle_items (bundleId, url, label, position)
    VALUES (?, ?, ?, ?)
  `).run(bundleId, data.url, data.label, data.position);

  return { id: result.lastInsertRowid, bundleId, ...data };
}

/**
 * Create a test file record (DB row only — no disk file)
 * @param {number} userId - Owner's user ID
 * @param {object} overrides - Override default values
 * @returns {object} Created file record
 */
function createTestFile(userId, overrides = {}) {
  const db = getTestDatabase();

  const defaults = {
    slug: `file${Date.now()}`,
    originalName: 'test-file.pdf',
    storedName: `${Date.now()}.pdf`,
    mimeType: 'application/pdf',
    size: 1024,
    expiresAt: null,
    activateAt: null,
    deactivateAt: null,
    maxDownloads: null,
    downloads: 0,
    password: null,
    sharingMode: 'public',
    allowedUsers: '[]',
    isBlocked: 0,
    isQuarantined: 0
  };

  const data = { ...defaults, ...overrides };

  const result = db.prepare(`
    INSERT INTO files
      (userId, slug, originalName, storedName, mimeType, size, expiresAt, activateAt, deactivateAt,
       maxDownloads, downloads, password, sharingMode, allowedUsers, isBlocked, isQuarantined)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId, data.slug, data.originalName, data.storedName, data.mimeType, data.size,
    data.expiresAt, data.activateAt, data.deactivateAt, data.maxDownloads, data.downloads,
    data.password, data.sharingMode, data.allowedUsers, data.isBlocked, data.isQuarantined
  );

  return { id: result.lastInsertRowid, userId, ...data };
}

function createTestPaste(userId = null, overrides = {}) {
  const db = getTestDatabase();

  const defaults = {
    slug: `paste${Date.now()}${Math.floor(Math.random() * 1000)}`,
    title: 'Test paste',
    content: 'hello world',
    language: null,
    expiresAt: null,
    activateAt: null,
    deactivateAt: null,
    maxViews: null,
    views: 0,
    password: null,
    isBlocked: 0,
    isQuarantined: 0
  };

  const data = { ...defaults, ...overrides };

  const result = db.prepare(`
    INSERT INTO pastes
      (userId, slug, title, content, language, expiresAt, activateAt, deactivateAt, maxViews, views, password, isBlocked, isQuarantined)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId, data.slug, data.title, data.content, data.language, data.expiresAt,
    data.activateAt, data.deactivateAt, data.maxViews, data.views, data.password, data.isBlocked, data.isQuarantined
  );

  return { id: result.lastInsertRowid, userId, ...data };
}

module.exports = {
  createTestUser,
  createTestUrl,
  createTestTag,
  createMockRequest,
  createMockResponse,
  createMockNext,
  tagItem,
  createTestReport,
  createTestBundle,
  createTestBundleItem,
  createTestFile,
  createTestPaste
};
