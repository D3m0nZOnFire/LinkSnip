const Url = require('../models/Url');
const Bundle = require('../models/Bundle');
const AnalyticsShare = require('../models/AnalyticsShare');
const File = require('../models/File');
const Paste = require('../models/Paste');
const RoleService = require('../services/roleService');
const configService = require('../services/configService');
const { withAccessStatus } = require('../services/accessService');
const { deletesInDays } = require('../services/retentionService');

class DashboardController {
  /**
   * Render user dashboard
   * GET /dashboard
   */
  static getUserDashboard(req, res) {
    // Pagination parameters
    const limit = req.query.limit ? (req.query.limit === 'all' ? null : parseInt(req.query.limit)) : 50;
    const page = parseInt(req.query.page) || 1;
    const offset = limit !== null ? (page - 1) * limit : 0;

    // Filter/sort parameters
    const search = req.query.search || '';
    const sort = req.query.sort || 'newest';

    // Get URLs and total count (with filters if provided)
    const filterOptions = { limit, offset, search, sort };
    const urls = Url.findByCreatorIdWithFilters(req.session.userId, filterOptions);
    const totalUrls = Url.countByCreatorIdWithFilters(req.session.userId, { search });

    // Number of active analytics share links per URL, and the deletion countdown
    const urlsWithShares = withAccessStatus('url', urls).map(url => ({
      ...url,
      shareCount: AnalyticsShare.countActive('url', url.id),
      deletesInDays: deletesInDays('url', url)
    }));

    // Switched-off features (settings.json → features.*) show no rows
    const features = configService.getSettings().features;

    // Get all bundles for the user (no pagination — typically few bundles)
    const bundles = features.bundles ? withAccessStatus('bundle', Bundle.findByCreatorId(req.session.userId)) : [];

    // Files for unified list (only for roles that can upload)
    const canUploadFiles = features.files && RoleService.can(req.user, 'uploadFiles');
    const files = canUploadFiles ? withAccessStatus('file', File.findByUserId(req.session.userId)) : [];
    const fileCount = files.length;

    // Pastes for unified list (available to every logged-in user)
    const pastes = features.pastes
      ? withAccessStatus('paste', Paste.findByUserId(req.session.userId))
        .map(paste => ({ ...paste, deletesInDays: deletesInDays('paste', paste) }))
      : [];
    const pasteCount = pastes.length;

    // Calculate pagination info
    const totalPages = limit !== null ? Math.ceil(totalUrls / limit) : 1;

    res.render('dashboard', {
      user: req.user,
      urls: urlsWithShares,
      bundles,
      baseUrl: `${req.protocol}://${req.get('host')}`,
      pagination: {
        currentPage: page,
        totalPages,
        limit: limit !== null ? limit : 'all',
        totalUrls,
        hasNext: page < totalPages,
        hasPrev: page > 1
      },
      filters: { search, sort },
      files,
      fileCount,
      canUploadFiles,
      pastes,
      pasteCount
    });
  }

  /**
   * Render admin dashboard
   * GET /admin
   */
  static getAdminDashboard(req, res) {
    // Pagination parameters
    const limit = req.query.limit ? (req.query.limit === 'all' ? null : parseInt(req.query.limit)) : 50;
    const page = parseInt(req.query.page) || 1;
    const offset = limit !== null ? (page - 1) * limit : 0;

    // Filter parameters
    const search = req.query.search || '';
    const status = req.query.status || '';
    const hasReports = req.query.hasReports || '';
    const sort = req.query.sort || 'newest';
    const dateFrom = req.query.dateFrom || '';
    const dateTo = req.query.dateTo || '';

    // Parse @shorthand tokens per OR group (split search on '|').
    // Tokens within a group are ANDed; groups are ORed.
    // Supported per group: @user:[name]  @user:![name]  @user:[a],[b]
    //                      @status:[value]  @anon  @protected
    //                      @clicks:>N  @clicks:<N  @clicks:N
    const rawGroups = search.split('|').map(s => s.trim());

    const filterGroups = rawGroups.map(groupSearch => {
      let cleanSearch = groupSearch;
      let creatorUsernames = [];
      let excludeCreatorUsernames = [];
      let groupStatus = '';
      let isAnonymous = false;   // @anon — additive, ANDs with @status: rather than replacing it
      let isProtected = false;   // @protected — same
      let minClicks = null;
      let maxClicks = null;

      const tokenRegex = /@(\w+)(?::(\S+))?/gi;
      let tokenMatch;
      while ((tokenMatch = tokenRegex.exec(groupSearch)) !== null) {
        const keyword = tokenMatch[1].toLowerCase();
        const value = tokenMatch[2] || '';
        cleanSearch = cleanSearch.replace(tokenMatch[0], '').trim();

        switch (keyword) {
          case 'user':
            if (value.startsWith('!')) {
              excludeCreatorUsernames.push(value.slice(1));
            } else {
              value.split(',').map(u => u.trim()).filter(Boolean).forEach(u => {
                if (u.toLowerCase() === 'anon' || u.toLowerCase() === 'anonymous') {
                  isAnonymous = true;
                } else {
                  creatorUsernames.push(u);
                }
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
            if (value.startsWith('>')) {
              minClicks = parseInt(value.slice(1));
            } else if (value.startsWith('<')) {
              maxClicks = parseInt(value.slice(1));
            } else if (!isNaN(parseInt(value))) {
              minClicks = maxClicks = parseInt(value);
            }
            break;
        }
      }

      return { cleanSearch, creatorUsernames, excludeCreatorUsernames, groupStatus, isAnonymous, isProtected, minClicks, maxClicks };
    });

    // If any group uses @status:/@anon/@protected, ignore the dropdown status
    // (let the groups control their own status logic)
    const anyGroupHasStatus = filterGroups.some(g => g.groupStatus || g.isAnonymous || g.isProtected);
    const effectiveGlobalStatus = anyGroupHasStatus ? '' : status;

    // Get URLs and total count with filters
    const filterOptions = { limit, offset, filterGroups, status: effectiveGlobalStatus, hasReports, sort, dateFrom, dateTo };
    const urls = withAccessStatus('url', Url.findAllWithFilters(filterOptions))
      .map(url => ({ ...url, deletesInDays: deletesInDays('url', url) }));
    const totalUrls = Url.countAllWithFilters({ filterGroups, status: effectiveGlobalStatus, hasReports, dateFrom, dateTo });

    // Get all bundles system-wide (no separate pagination — same pattern as user dashboard)
    const bundles = withAccessStatus('bundle', Bundle.findAll());
    const totalBundles = Bundle.countAll();

    // Calculate pagination info
    const totalPages = limit !== null ? Math.ceil(totalUrls / limit) : 1;

    res.render('admin', {
      user: req.user,
      urls,
      bundles,
      baseUrl: `${req.protocol}://${req.get('host')}`,
      pagination: {
        currentPage: page,
        totalPages,
        limit: limit !== null ? limit : 'all',
        totalUrls,
        totalBundles,
        hasNext: page < totalPages,
        hasPrev: page > 1
      },
      filters: {
        search,
        status,
        hasReports,
        sort,
        dateFrom,
        dateTo
      }
    });
  }

  /**
   * Get user URLs as JSON (for AJAX requests)
   * GET /api/dashboard/urls
   */
  static getUserUrlsApi(req, res) {
    const urls = Url.findByCreatorId(req.session.userId);
    res.json(urls);
  }

  /**
   * Get all URLs as JSON (for admin AJAX requests)
   * GET /api/admin/urls
   */
  static getAllUrlsApi(req, res) {
    const urls = Url.findAll();
    res.json(urls);
  }
}

module.exports = DashboardController;