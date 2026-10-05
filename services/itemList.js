const db = require('../config/database');
const { CONTENT_TYPES, enabledTypes } = require('./contentTypes');
const { statusSql } = require('./accessService');
const { deletesInDays } = require('./retentionService');
const Tag = require('../models/Tag');
const { scopeCondition } = require('./itemScope');

/**
 * Links, bundles, pastes and files in one list: Admin → Items (/admin/items, every item) and the dashboard
 * (one user's personal items or a team's, through `scope`).
 *
 * Search syntax (one or more groups separated by |; tokens within a group are ANDed, groups are ORed):
 *   text              slug, destination / title / file name, or owner name contains it
 *   @user:alice       owned by alice (@user:alice,bob: either; @user:anon or @anon: no owner)
 *   @user:!alice      not owned by alice
 *   @status:expired   active · blocked · expired · scheduled · max-uses · quarantined · anonymous · password-protected
 *   @protected        password-protected
 *   @uses:>N  @uses:<N  @uses:N   clicks, views or downloads (@clicks: works too)
 */

// Status filter values → accessService statuses (the visitor's view, computed in SQL)
const STATUS_FILTERS = {
  active: 'active',
  blocked: 'blocked',
  expired: 'expired',
  scheduled: 'scheduled',
  'max-uses': 'limit_reached',
  quarantined: 'quarantined'
};

// What each type shows as its label, and which of its columns the text search looks in
const LABEL = {
  url: 't.longUrl',
  bundle: 't.title',
  paste: "COALESCE(NULLIF(t.title, ''), 'Untitled paste')",
  file: 't.originalName'
};
const SEARCHED = {
  url: ['t.longUrl'],
  bundle: ['t.title', 't.description'],
  paste: ['t.title'],
  file: ['t.originalName']
};

const SORTS = {
  newest: 'createdAt DESC, type, id DESC',
  oldest: 'createdAt ASC, type, id ASC',
  'most-used': 'uses DESC, createdAt DESC',
  'least-used': 'uses ASC, createdAt DESC',
  'most-reports': 'reportCount DESC, createdAt DESC',
  // names from the old links list
  'most-clicks': 'uses DESC, createdAt DESC',
  'least-clicks': 'uses ASC, createdAt DESC'
};

/**
 * The search box → groups of conditions (see the syntax above).
 * @returns {Array<{ cleanSearch, creatorUsernames, excludeCreatorUsernames, groupStatus, isAnonymous, isProtected,
 *   minClicks, maxClicks }>}
 */
function parseSearch(search = '') {
  return String(search).split('|').map(s => s.trim()).map(groupSearch => {
    let cleanSearch = groupSearch;
    const creatorUsernames = [];
    const excludeCreatorUsernames = [];
    let groupStatus = '';
    let isAnonymous = false; // ANDs with @status: rather than replacing it
    let isProtected = false;
    let minClicks = null;
    let maxClicks = null;

    const tokenRegex = /@(\w+)(?::(\S+))?/gi;
    let match;
    while ((match = tokenRegex.exec(groupSearch)) !== null) {
      const keyword = match[1].toLowerCase();
      const value = match[2] || '';
      cleanSearch = cleanSearch.replace(match[0], '').trim();

      switch (keyword) {
        case 'user':
          if (value.startsWith('!')) {
            excludeCreatorUsernames.push(value.slice(1));
          } else {
            value.split(',').map(u => u.trim()).filter(Boolean).forEach(u => {
              if (['anon', 'anonymous'].includes(u.toLowerCase())) isAnonymous = true;
              else creatorUsernames.push(u);
            });
          }
          break;
        case 'status':
          groupStatus = value;
          break;
        case 'anon':
          isAnonymous = true;
          break;
        case 'protected':
          isProtected = true;
          break;
        case 'clicks':
        case 'uses':
          if (value.startsWith('>')) minClicks = parseInt(value.slice(1), 10);
          else if (value.startsWith('<')) maxClicks = parseInt(value.slice(1), 10);
          else if (!isNaN(parseInt(value, 10))) minClicks = maxClicks = parseInt(value, 10);
          break;
      }
    }

    return { cleanSearch, creatorUsernames, excludeCreatorUsernames, groupStatus, isAnonymous, isProtected, minClicks, maxClicks };
  });
}

/** The status dropdown counts only when the search has no status tokens of its own */
function effectiveStatus(groups, status) {
  return groups.some(g => g.groupStatus || g.isAnonymous || g.isProtected) ? '' : (status || '');
}

/** The types the list can show (features on), in a fixed order */
function types() {
  return enabledTypes();
}

const hasPassword = "(t.password IS NOT NULL AND t.password <> '')";

// One group's conditions for one type, ANDed
function groupConditions(type, group, globalStatus, now) {
  const info = CONTENT_TYPES[type];
  const used = `t.${info.usedColumn}`;
  const owner = `t.${info.ownerColumn}`;
  const conditions = [];
  const params = [];

  const text = (group.cleanSearch || '').trim();
  if (text) {
    const columns = ['t.slug', ...SEARCHED[type], 'u.username'];
    conditions.push(`(${columns.map(c => `${c} LIKE ?`).join(' OR ')})`);
    params.push(...columns.map(() => `%${text}%`));
  }

  // @user:alice,bob and @anon / @user:anon OR together
  const owners = [];
  for (const name of group.creatorUsernames || []) {
    owners.push('u.username LIKE ?');
    params.push(`%${name}%`);
  }
  if (group.isAnonymous) owners.push(`${owner} IS NULL`);
  if (owners.length) conditions.push(`(${owners.join(' OR ')})`);

  const excluded = group.excludeCreatorUsernames || [];
  if (excluded.length) {
    conditions.push(`(u.username IS NULL OR (${excluded.map(() => 'u.username NOT LIKE ?').join(' AND ')}))`);
    params.push(...excluded.map(name => `%${name.trim()}%`));
  }

  const { minClicks: min = null, maxClicks: max = null } = group;
  if (min !== null && min === max) {
    conditions.push(`${used} = ?`);
    params.push(min);
  } else {
    if (min !== null) { conditions.push(`${used} > ?`); params.push(min); }
    if (max !== null) { conditions.push(`${used} < ?`); params.push(max); }
  }

  if (group.isProtected) conditions.push(hasPassword);

  const status = group.groupStatus || globalStatus || '';
  if (STATUS_FILTERS[status]) {
    const expr = statusSql(type, { alias: 't', now });
    conditions.push(`(${expr.sql}) = ?`);
    params.push(...expr.params, STATUS_FILTERS[status]);
  } else if (status === 'anonymous') {
    conditions.push(`${owner} IS NULL`);
  } else if (status === 'password-protected') {
    conditions.push(hasPassword);
  }

  return { conditions, params };
}

// SELECT for one type, rows in the shape every type shares
function typeQuery(type, { groups, status, dateFrom, dateTo, now, scope, tags, tagMatch }) {
  const info = CONTENT_TYPES[type];
  const access = statusSql(type, { alias: 't', now });
  const params = [...access.params];
  const where = [];

  if (scope !== undefined && scope !== null) {
    const owned = scopeCondition(type, scope, { alias: 't' });
    where.push(`(${owned.sql})`);
    params.push(...owned.params);
  }
  if (tags.length) {
    const tagged = `FROM taggables tg JOIN tags g ON g.id = tg.tagId
      WHERE tg.targetType = '${type}' AND tg.targetId = t.id AND g.name IN (${tags.map(() => '?').join(', ')})`;
    // any: one of the tags is enough; all: every one of them (tag names are unique per item's owner or team)
    where.push(tagMatch === 'all' ? `(SELECT COUNT(DISTINCT g.name) ${tagged}) = ${tags.length}` : `EXISTS (SELECT 1 ${tagged})`);
    params.push(...tags);
  }

  if (dateFrom && dateFrom.trim()) { where.push('DATE(t.createdAt) >= ?'); params.push(dateFrom.trim()); }
  if (dateTo && dateTo.trim()) { where.push('DATE(t.createdAt) <= ?'); params.push(dateTo.trim()); }

  const built = groups.map(group => groupConditions(type, group, status, now));
  // A group without conditions matches everything, so the whole OR does
  if (built.length && built.every(g => g.conditions.length)) {
    where.push(`(${built.map(g => `(${g.conditions.join(' AND ')})`).join(' OR ')})`);
    built.forEach(g => params.push(...g.params));
  }

  const sql = `
    SELECT '${type}' AS type, t.id, t.slug, ${LABEL[type]} AS label, t.createdAt,
           COALESCE(t.${info.usedColumn}, 0) AS uses, t.${info.limitColumn} AS usageLimit,
           t.${info.ownerColumn} AS ownerId, u.username AS ownerUsername, u.isAdmin AS ownerIsAdmin,
           CASE WHEN ${hasPassword} THEN 1 ELSE 0 END AS hasPassword,
           COALESCE(t.isBlocked, 0) AS isBlocked, ${info.quarantine ? 'COALESCE(t.isQuarantined, 0)' : '0'} AS isQuarantined,
           t.expiresAt, t.activateAt, t.deactivateAt, t.teamId, ${type === 'file' ? 't.size' : 'NULL'} AS size,
           (SELECT COUNT(*) FROM reports r
             WHERE r.targetType = '${type}' AND r.targetId = t.id AND r.status = 'pending') AS reportCount,
           ${access.sql} AS accessStatus
    FROM ${info.table} t
    LEFT JOIN users u ON u.id = t.${info.ownerColumn}
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;
  return { sql, params };
}

// The types' SELECTs joined into one
function unionOf(typeList, options) {
  const parts = typeList.map(t => typeQuery(t, options));
  return { union: parts.map(p => p.sql).join('\nUNION ALL\n'), params: parts.flatMap(p => p.params) };
}

/**
 * @param {object} options - { type: 'all' | 'url' | …, search, status, hasReports ('yes'|'no'), sort, dateFrom, dateTo,
 *   page, limit (null = all), scope (services/itemScope.js: a user ID, { userId } or { teamId }; none = every item),
 *   tags (tag names), tagMatch ('any' (default): items with one of the tags, 'all': with every one of them),
 *   types (only these of the enabled types) }
 * @returns {{ rows, total, page, totalPages, limit, counts }} counts: matches per enabled type, whatever `type` shows
 */
function list({
  type = 'all', search = '', status = '', hasReports = '', sort = 'newest', dateFrom = '', dateTo = '', page = 1,
  limit = 50, scope = null, tags = [], tagMatch = 'any', types: only = null
} = {}) {
  const listed = only ? types().filter(t => only.includes(t)) : types();
  const groups = parseSearch(search);
  const options = {
    groups, status: effectiveStatus(groups, status), dateFrom, dateTo, now: new Date().toISOString(), scope, tagMatch,
    tags: [...new Set((tags || []).map(name => String(name).trim().toLowerCase()).filter(Boolean))]
  };
  const reports = hasReports === 'yes' ? 'WHERE reportCount > 0' : hasReports === 'no' ? 'WHERE reportCount = 0' : '';

  const counts = Object.fromEntries(listed.map(t => [t, 0]));
  if (listed.length) {
    const all = unionOf(listed, options);
    db.prepare(`SELECT type, COUNT(*) AS n FROM (${all.union}) items ${reports} GROUP BY type`).all(...all.params)
      .forEach(({ type: t, n }) => { counts[t] = n; });
  }

  const shown = (type === 'all' || !type) ? listed : listed.filter(t => t === type);
  if (!shown.length) return { rows: [], total: 0, page: 1, totalPages: 1, limit, counts };
  const { union, params } = unionOf(shown, options);

  const total = db.prepare(`SELECT COUNT(*) AS n FROM (${union}) items ${reports}`).get(...params).n;
  const totalPages = limit ? Math.max(1, Math.ceil(total / limit)) : 1;
  const current = Math.min(Math.max(1, parseInt(page, 10) || 1), totalPages);

  let sql = `SELECT * FROM (${union}) items ${reports} ORDER BY ${SORTS[sort] || SORTS.newest}`;
  const rowParams = [...params];
  if (limit) {
    sql += ' LIMIT ? OFFSET ?';
    rowParams.push(limit, (current - 1) * limit);
  }

  const rows = db.prepare(sql).all(...rowParams).map(row => {
    const info = CONTENT_TYPES[row.type];
    return {
      ...row,
      path: `${info.publicPrefix}${row.slug}`,
      infoPath: info.infoPrefix ? `${info.infoPrefix}${row.slug}` : null,
      deletesInDays: deletesInDays(row.type, { ...row, [info.ownerColumn]: row.ownerId }),
      tags: Tag.forItem(row.type, row.id)
    };
  });

  return { rows, total, page: current, totalPages, limit, counts };
}

module.exports = { list, parseSearch, effectiveStatus, types, STATUS_FILTERS };
