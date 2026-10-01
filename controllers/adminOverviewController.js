const adminOverview = require('../services/adminOverview');

/**
 * GET /admin: the first page of admin mode
 */
exports.overviewPage = (req, res) => {
  res.render('admin-overview', { user: req.user, summary: adminOverview.summary() });
};
