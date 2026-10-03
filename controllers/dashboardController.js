const Url = require('../models/Url');
const AnalyticsShare = require('../models/AnalyticsShare');
const Tag = require('../models/Tag');
const Team = require('../models/Team');
const RoleService = require('../services/roleService');
const { enabledFeatures } = require('../middleware/requireFeature');
const itemList = require('../services/itemList');
const { contentType } = require('../services/contentTypes');
const teamService = require('../services/teamService');
const { canEdit, canMoveToTeam, canMoveFromTeam } = require('../services/itemPermissions');

const PAGE_SIZES = [25, 50, 100];
const SORTS = ['newest', 'oldest', 'most-used', 'least-used'];

class DashboardController {
  /**
   * The user's items (or a team's, ?team=:id): links, bundles, pastes and files in one list (services/itemList.js).
   * Filters: search, type, tag, sort, limit, page. ?partial=1 renders only the results, for the live search.
   * GET /dashboard
   */
  static getUserDashboard(req, res) {
    const features = enabledFeatures();

    // Whose items: the user's personal ones, or a team's (?team=:id, for its members and site admins)
    const dashboardTeams = features.teams ? teamService.listForUser(req.user) : [];
    const writableTeams = dashboardTeams.filter(team => team.role !== 'viewer');
    let currentTeam = null;
    let scope = req.user.id;
    if (features.teams && req.query.team) {
      const team = Team.findById(Number(req.query.team));
      const role = team ? (Team.memberRole(team.id, req.user.id) || (req.user.isAdmin ? 'owner' : null)) : null;
      if (!role) {
        return res.status(404).render('error', { title: 'Not Found', message: 'This team does not exist.', code: 404 });
      }
      currentTeam = { id: team.id, name: team.name, role };
      scope = { teamId: team.id };
    }

    // Files: personal ones for roles that can upload (the file API needs it); a team's for every member
    const canUploadFiles = features.files && RoleService.can(req.user, 'uploadFiles');
    const types = itemList.types().filter(type => type !== 'file' || canUploadFiles || !!currentTeam);

    const q = req.query;
    const filters = {
      search: typeof q.search === 'string' ? q.search.trim() : '',
      type: types.includes(q.type) ? q.type : 'all',
      tag: typeof q.tag === 'string' ? q.tag.trim().toLowerCase() : '',
      sort: SORTS.includes(q.sort) ? q.sort : ({ 'most-clicks': 'most-used', 'least-clicks': 'least-used' })[q.sort] || 'newest',
      limit: PAGE_SIZES.includes(Number(q.limit)) ? Number(q.limit) : 50
    };

    const result = itemList.list({
      scope, types, type: filters.type, search: filters.search, tags: filters.tag ? [filters.tag] : [],
      sort: filters.sort, limit: filters.limit, page: q.page
    });

    // What the user may do to each row (team rows: by their role in the team)
    result.rows = result.rows.map(row => {
      const item = { ...row, [contentType(row.type).ownerColumn]: row.ownerId };
      return {
        ...row,
        canEdit: canEdit(req.user, row.type, item),
        canMoveIn: !currentTeam && writableTeams.some(team => canMoveToTeam(req.user, row.type, item, team.id)),
        canMoveOut: !!currentTeam && canMoveFromTeam(req.user, row.type, item),
        shareCount: features.analyticsShareLinks ? AnalyticsShare.countActive(row.type, row.id) : 0
      };
    });

    const tagOptions = currentTeam ? Tag.forTeam(currentTeam.id) : Tag.findByUserId(req.user.id).filter(tag => !tag.teamId);

    const view = {
      user: req.user,
      teamInvites: features.teams ? teamService.invitesForUser(req.user) : [],
      dashboardTeams,
      writableTeams,
      currentTeam,
      types,
      filters,
      result,
      tagOptions,
      pageSizes: PAGE_SIZES,
      canUploadFiles,
      baseUrl: `${req.protocol}://${req.get('host')}`
    };
    res.render(q.partial === '1' ? 'partials/dashboard-results' : 'dashboard', view);
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