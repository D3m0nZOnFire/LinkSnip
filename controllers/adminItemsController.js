const adminItems = require('../services/itemList');

/**
 * Admin → Items (/admin/items): links, bundles, pastes and files in one list. The search syntax is documented in
 * services/itemList.js; actions use /api/admin/:type/… (adminItemController).
 */
const PAGE_SIZES = [25, 50, 100];

exports.itemsPage = (req, res, next) => {
  const q = req.query || {};
  const type = q.type || 'all';
  if (type !== 'all' && !adminItems.types().includes(type)) return next();

  const limit = PAGE_SIZES.includes(Number(q.limit)) ? Number(q.limit) : 50;
  const filters = {
    type,
    search: q.search || '',
    status: q.status || '',
    hasReports: q.hasReports || '',
    sort: q.sort || 'newest',
    dateFrom: q.dateFrom || '',
    dateTo: q.dateTo || '',
    limit
  };

  res.render('admin-items', {
    user: req.user,
    filters,
    types: adminItems.types(),
    pageSizes: PAGE_SIZES,
    result: adminItems.list({ ...filters, page: q.page }),
    baseUrl: `${req.protocol}://${req.get('host')}`
  });
};

/**
 * The lists the Items page replaced: /admin/links, /admin/files, /admin/pastes → /admin/items?type=…, filters kept
 */
exports.redirectTo = (type) => (req, res) => {
  const query = new URLSearchParams(req.query || {});
  query.delete('type');
  const rest = query.toString();
  res.redirect(302, `/admin/items?type=${type}${rest ? `&${rest}` : ''}`);
};
