const User = require('../models/User');
const db = require('../config/database');
const bcrypt = require('bcrypt');
const { logAdminAction, ACTIONS } = require('../services/auditService');
const ScheduledTasks = require('../services/scheduledTasks');
const RoleService = require('../services/roleService');
const configService = require('../services/configService');

class AdminController {
  /**
   * Render admin users page
   * GET /admin/users
   */
  static getUsersPage(req, res) {
    // Filter parameters
    const search = req.query.search || '';
    const role = req.query.role || '';
    const status = req.query.status || '';
    const userRole = req.query.userRole || '';
    const activity = req.query.activity || '';
    const sort = req.query.sort || 'newest';

    // Build query with filters
    let query = `
      SELECT
        u.id,
        u.username,
        u.email,
        u.isAdmin,
        u.isBanned,
        u.role,
        u.lastActive,
        u.createdAt,
        COUNT(DISTINCT url.id) as urlCount,
        COALESCE(SUM(url.clicks), 0) as totalClicks
      FROM users u
      LEFT JOIN urls url ON u.id = url.creatorId
    `;

    const conditions = [];
    const params = [];

    // Search filter (username or email)
    if (search && search.trim()) {
      conditions.push(`(u.username LIKE ? OR u.email LIKE ?)`);
      const searchTerm = `%${search.trim()}%`;
      params.push(searchTerm, searchTerm);
    }

    // Role filter
    if (role === 'admin') {
      conditions.push(`u.isAdmin = 1`);
    } else if (role === 'user') {
      conditions.push(`u.isAdmin = 0`);
    }

    // Status filter
    if (status === 'active') {
      conditions.push(`u.isBanned = 0`);
    } else if (status === 'banned') {
      conditions.push(`u.isBanned = 1`);
    }

    // Account role filter. NULL and unknown roles resolve to the defaultRole, so they match it too.
    if (userRole) {
      const { defaultRole } = configService.getRoles();
      if (userRole === defaultRole) {
        const known = RoleService.listRoles().map(r => r.name);
        conditions.push(`(u.role IS NULL OR u.role = ? OR u.role NOT IN (${known.map(() => '?').join(', ')}))`);
        params.push(userRole, ...known);
      } else {
        conditions.push('u.role = ?');
        params.push(userRole);
      }
    }

    // Activity filter
    if (activity && activity !== '') {
      const now = new Date();
      switch (activity) {
        case 'today':
          conditions.push(`DATE(u.lastActive) = DATE('now')`);
          break;
        case '7days':
          conditions.push(`u.lastActive >= datetime('now', '-7 days')`);
          break;
        case '30days':
          conditions.push(`u.lastActive >= datetime('now', '-30 days')`);
          break;
        case '90days':
          conditions.push(`u.lastActive >= datetime('now', '-90 days')`);
          break;
        case 'inactive30':
          conditions.push(`(u.lastActive IS NULL OR u.lastActive < datetime('now', '-30 days'))`);
          break;
        case 'inactive90':
          conditions.push(`(u.lastActive IS NULL OR u.lastActive < datetime('now', '-90 days'))`);
          break;
        case 'never':
          conditions.push(`u.lastActive IS NULL`);
          break;
      }
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ` GROUP BY u.id`;

    // Sort options
    switch (sort) {
      case 'oldest':
        query += ` ORDER BY u.createdAt ASC`;
        break;
      case 'most-urls':
        query += ` ORDER BY urlCount DESC, u.createdAt DESC`;
        break;
      case 'most-clicks':
        query += ` ORDER BY totalClicks DESC, u.createdAt DESC`;
        break;
      case 'recently-active':
        query += ` ORDER BY u.lastActive DESC NULLS LAST`;
        break;
      case 'username':
        query += ` ORDER BY u.username ASC`;
        break;
      case 'newest':
      default:
        query += ` ORDER BY u.createdAt DESC`;
        break;
    }

    const stmt = db.prepare(query);
    const users = stmt.all(...params).map(u => {
      const role = RoleService.getRole({ role: u.role });
      return { ...u, roleName: role.name, roleLabel: role.label, roleIsDefault: role.name !== u.role };
    });

    res.render('admin-users', {
      user: req.user,
      users: users,
      roles: RoleService.listRoles(),
      defaultRole: configService.getRoles().defaultRole,
      currentUserId: req.session.userId,
      filters: {
        search,
        role,
        status,
        userRole,
        activity,
        sort
      }
    });
  }

  /**
   * Create a user (works whether or not registration is open)
   * POST /api/admin/users
   */
  static async createUser(req, res) {
    const { username, email, password, isAdmin } = req.body;
    const role = req.body.role || null; // null = follows roles.json defaultRole

    if (!username || !String(username).trim()) {
      return res.status(400).json({ error: 'Username is required' });
    }
    if (!password || String(password).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    if (role !== null && !RoleService.isAssignable(role)) {
      return res.status(400).json({ error: `Unknown role: ${role}` });
    }

    try {
      const created = await User.create(String(username).trim(), password, !!isAdmin, email || null);
      if (role) User.updateRole(created.id, role);

      logAdminAction(ACTIONS.CREATE_USER, req, 'user', created.id, created.username, {
        role, isAdmin: !!isAdmin, email: email || null
      });

      res.status(201).json({ success: true, user: User.findById(created.id) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  /**
   * Get single user
   * GET /api/admin/users/:id
   */
  static getUser(req, res) {
    const { id } = req.params;

    try {
      const stmt = db.prepare(`
        SELECT
          u.id,
          u.username,
          u.email,
          u.isAdmin,
          u.isBanned,
          u.role,
          u.lastActive,
          u.createdAt,
          COUNT(DISTINCT url.id) as urlCount
        FROM users u
        LEFT JOIN urls url ON u.id = url.creatorId
        WHERE u.id = ?
        GROUP BY u.id
      `);

      const user = stmt.get(id);

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.json(user);
    } catch (error) {
      console.error('Get user error:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Update user
   * PUT /api/admin/users/:id
   */
  static async updateUser(req, res) {
    const { id } = req.params;
    const { username, email, isAdmin, isBanned, password } = req.body;
    // '' or null means "the default role" (stored as NULL, follows roles.json defaultRole)
    const role = req.body.role === undefined ? undefined : (req.body.role || null);

    const isSelf = parseInt(id) === req.session.userId;

    try {
      const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
      const user = stmt.get(id);

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Build update query
      let updateFields = [];
      let values = [];

      if (username && username !== user.username) {
        updateFields.push('username = ?');
        values.push(username);
      }

      if (email !== undefined && email !== user.email) {
        updateFields.push('email = ?');
        values.push(email || null);
      }

      if (isAdmin !== undefined) {
        if (isSelf && !isAdmin) {
          return res.status(400).json({ error: 'You cannot remove your own admin privileges' });
        }
        updateFields.push('isAdmin = ?');
        values.push(isAdmin ? 1 : 0);
      }

      if (isBanned !== undefined) {
        if (isSelf && isBanned) {
          return res.status(400).json({ error: 'You cannot ban your own account' });
        }
        updateFields.push('isBanned = ?');
        values.push(isBanned ? 1 : 0);
      }

      if (role !== undefined && role !== user.role) {
        if (role !== null && !RoleService.isAssignable(role)) {
          return res.status(400).json({ error: `Unknown role: ${role}` });
        }
        updateFields.push('role = ?');
        values.push(role);
      }

      if (password && password.trim() !== '') {
        const hashedPassword = await bcrypt.hash(password, 10);
        updateFields.push('password = ?');
        values.push(hashedPassword);
      }

      if (updateFields.length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
      }

      values.push(id);

      const updateStmt = db.prepare(`
        UPDATE users
        SET ${updateFields.join(', ')}
        WHERE id = ?
      `);

      try {
        updateStmt.run(...values);

        // Log admin action with details of what changed
        const changes = {};
        if (username !== user.username) changes.username = { from: user.username, to: username };
        if (email !== user.email) changes.email = { from: user.email, to: email };
        if (isAdmin !== undefined && isAdmin !== user.isAdmin) {
          changes.isAdmin = { from: user.isAdmin, to: isAdmin };
          logAdminAction(
            isAdmin ? ACTIONS.GRANT_ADMIN : ACTIONS.REVOKE_ADMIN,
            req,
            'user',
            user.id,
            `${user.username}`,
            changes
          );
        }
        if (isBanned !== undefined && isBanned !== user.isBanned) {
          changes.isBanned = { from: user.isBanned, to: isBanned };
          logAdminAction(
            isBanned ? ACTIONS.BAN_USER : ACTIONS.UNBAN_USER,
            req,
            'user',
            user.id,
            `${user.username}`,
            changes
          );
        }
        if (role !== undefined && role !== user.role) {
          changes.role = { from: user.role, to: role };
          logAdminAction(
            ACTIONS.UPDATE_USER,
            req,
            'user',
            user.id,
            `${user.username} - Role changed to ${role || 'default'}`,
            changes
          );
        }
        if (password) changes.passwordChanged = true;

        // Log general update if other fields changed
        if (Object.keys(changes).length > 0 && !changes.isAdmin && !changes.isBanned) {
          logAdminAction(ACTIONS.UPDATE_USER, req, 'user', user.id, `${user.username}`, changes);
        }

        res.json({ success: true });
      } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT') {
          return res.status(400).json({ error: 'Username or email already exists' });
        }
        throw error;
      }
    } catch (error) {
      console.error('Update user error:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Delete user
   * DELETE /api/admin/users/:id
   */
  static deleteUser(req, res) {
    const { id } = req.params;

    // Prevent admin from deleting themselves
    if (parseInt(id) === req.session.userId) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    try {
      const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
      const user = stmt.get(id);
      
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const deleteStmt = db.prepare('DELETE FROM users WHERE id = ?');
      deleteStmt.run(id);

      // Log user deletion
      logAdminAction(ACTIONS.DELETE_USER, req, 'user', user.id, `${user.username}`, {
        email: user.email,
        wasAdmin: user.isAdmin,
        wasBanned: user.isBanned
      });

      res.json({ success: true });
    } catch (error) {
      console.error('Delete user error:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Ban/Unban user
   * POST /api/admin/users/:id/ban
   */
  static banUser(req, res) {
    const { id } = req.params;
    const { banned } = req.body;

    // Prevent admin from banning themselves
    if (parseInt(id) === req.session.userId) {
      return res.status(400).json({ error: 'Cannot ban yourself' });
    }

    try {
      const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
      const user = stmt.get(id);

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const updateStmt = db.prepare('UPDATE users SET isBanned = ? WHERE id = ?');
      updateStmt.run(banned ? 1 : 0, id);

      // Log ban/unban action
      logAdminAction(
        banned ? ACTIONS.BAN_USER : ACTIONS.UNBAN_USER,
        req,
        'user',
        user.id,
        `${user.username}`,
        { previousStatus: user.isBanned, newStatus: banned }
      );

      res.json({ success: true });
    } catch (error) {
      console.error('Ban user error:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Trigger manual database backup
   * POST /api/admin/maintenance/backup
   */
  static async manualBackup(req, res) {
    try {
      const backupPath = await ScheduledTasks.manualBackup();

      logAdminAction(
        ACTIONS.SYSTEM_MAINTENANCE,
        req,
        'system',
        null,
        'Manual database backup',
        { action: 'backup', file: require('path').basename(backupPath) }
      );

      res.json({
        success: true,
        message: 'Database backup created successfully'
      });
    } catch (error) {
      console.error('Manual backup error:', error);
      res.status(500).json({ error: 'Failed to create backup' });
    }
  }

  /**
   * Trigger manual audit log cleanup
   * POST /api/admin/maintenance/cleanup
   */
  static manualCleanup(req, res) {
    try {
      ScheduledTasks.manualCleanup();

      logAdminAction(
        ACTIONS.SYSTEM_MAINTENANCE,
        req,
        'system',
        null,
        'Manual audit log cleanup',
        { action: 'cleanup' }
      );

      res.json({
        success: true,
        message: 'Audit log cleanup completed'
      });
    } catch (error) {
      console.error('Manual cleanup error:', error);
      res.status(500).json({ error: 'Failed to cleanup audit logs' });
    }
  }

  /**
   * Block a URL
   * POST /api/admin/urls/:id/block
   */
  static blockUrl(req, res) {
    const { id } = req.params;

    try {
      const Url = require('../models/Url');
      const url = Url.findById(id);

      if (!url) {
        return res.status(404).json({ error: 'URL not found' });
      }

      // Block the URL
      Url.block(id);

      // Log the action
      logAdminAction(ACTIONS.BLOCK_URL, req, 'url', id, `/s/${url.slug} → ${url.longUrl}`, {
        slug: url.slug,
        manual: true
      });

      res.json({
        success: true,
        message: 'URL blocked successfully'
      });

    } catch (error) {
      console.error('Block URL error:', error);
      res.status(500).json({ error: 'Failed to block URL' });
    }
  }

  /**
   * Unblock a URL
   * POST /api/admin/urls/:id/unblock
   */
  static unblockUrl(req, res) {
    const { id } = req.params;

    try {
      const Url = require('../models/Url');
      const url = Url.findById(id);

      if (!url) {
        return res.status(404).json({ error: 'URL not found' });
      }

      // Unblock the URL
      Url.unblock(id);

      // Log the action
      logAdminAction(ACTIONS.UNBLOCK_URL, req, 'url', id, `/s/${url.slug} → ${url.longUrl}`, {
        slug: url.slug
      });

      res.json({
        success: true,
        message: 'URL unblocked successfully'
      });

    } catch (error) {
      console.error('Unblock URL error:', error);
      res.status(500).json({ error: 'Failed to unblock URL' });
    }
  }

  /**
   * Bulk block URLs
   * POST /api/admin/urls/bulk-block
   */
  static bulkBlockUrls(req, res) {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids must be a non-empty array' });
    }
    if (ids.length > 200) {
      return res.status(400).json({ error: 'Cannot block more than 200 URLs at once' });
    }

    const UrlModel = require('../models/Url');
    let blocked = 0;
    const errors = [];

    for (const id of ids) {
      try {
        const url = UrlModel.findById(id);
        if (!url) { errors.push(`${id}: not found`); continue; }
        UrlModel.block(id);
        logAdminAction(ACTIONS.BLOCK_URL, req, 'url', id, `/s/${url.slug} → ${url.longUrl}`, {
          slug: url.slug, manual: true, bulk: true
        });
        blocked++;
      } catch (err) {
        errors.push(`${id}: ${err.message}`);
      }
    }

    res.json({ success: true, blocked, errors });
  }

  /**
   * Bulk unblock URLs
   * POST /api/admin/urls/bulk-unblock
   */
  static bulkUnblockUrls(req, res) {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids must be a non-empty array' });
    }
    if (ids.length > 200) {
      return res.status(400).json({ error: 'Cannot unblock more than 200 URLs at once' });
    }

    const UrlModel = require('../models/Url');
    let unblocked = 0;
    const errors = [];

    for (const id of ids) {
      try {
        const url = UrlModel.findById(id);
        if (!url) { errors.push(`${id}: not found`); continue; }
        UrlModel.unblock(id);
        logAdminAction(ACTIONS.UNBLOCK_URL, req, 'url', id, `/s/${url.slug} → ${url.longUrl}`, {
          slug: url.slug, bulk: true
        });
        unblocked++;
      } catch (err) {
        errors.push(`${id}: ${err.message}`);
      }
    }

    res.json({ success: true, unblocked, errors });
  }

  /**
   * Block a bundle
   * POST /api/admin/bundles/:id/block
   */
  static blockBundle(req, res) {
    const { id } = req.params;
    try {
      const Bundle = require('../models/Bundle');
      const bundle = Bundle.findById(id);
      if (!bundle) return res.status(404).json({ error: 'Bundle not found' });
      Bundle.block(id);
      logAdminAction(ACTIONS.BLOCK_BUNDLE, req, 'bundle', id, `/b/${bundle.slug} - "${bundle.title}"`, {
        slug: bundle.slug, manual: true
      });
      res.json({ success: true, message: 'Bundle blocked successfully' });
    } catch (error) {
      console.error('Block bundle error:', error);
      res.status(500).json({ error: 'Failed to block bundle' });
    }
  }

  /**
   * Unblock a bundle
   * POST /api/admin/bundles/:id/unblock
   */
  static unblockBundle(req, res) {
    const { id } = req.params;
    try {
      const Bundle = require('../models/Bundle');
      const bundle = Bundle.findById(id);
      if (!bundle) return res.status(404).json({ error: 'Bundle not found' });
      Bundle.unblock(id);
      logAdminAction(ACTIONS.UNBLOCK_BUNDLE, req, 'bundle', id, `/b/${bundle.slug} - "${bundle.title}"`, {
        slug: bundle.slug
      });
      res.json({ success: true, message: 'Bundle unblocked successfully' });
    } catch (error) {
      console.error('Unblock bundle error:', error);
      res.status(500).json({ error: 'Failed to unblock bundle' });
    }
  }

  /**
   * Bulk block bundles
   * POST /api/admin/bundles/bulk-block
   */
  static bulkBlockBundles(req, res) {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids must be a non-empty array' });
    }
    if (ids.length > 200) {
      return res.status(400).json({ error: 'Cannot block more than 200 bundles at once' });
    }

    const Bundle = require('../models/Bundle');
    let blocked = 0;
    const errors = [];

    for (const id of ids) {
      try {
        const bundle = Bundle.findById(id);
        if (!bundle) { errors.push(`${id}: not found`); continue; }
        Bundle.block(id);
        logAdminAction(ACTIONS.BLOCK_BUNDLE, req, 'bundle', id, `/b/${bundle.slug} - "${bundle.title}"`, {
          slug: bundle.slug, manual: true, bulk: true
        });
        blocked++;
      } catch (err) {
        errors.push(`${id}: ${err.message}`);
      }
    }

    res.json({ success: true, blocked, errors });
  }

  /**
   * Bulk unblock bundles
   * POST /api/admin/bundles/bulk-unblock
   */
  static bulkUnblockBundles(req, res) {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids must be a non-empty array' });
    }
    if (ids.length > 200) {
      return res.status(400).json({ error: 'Cannot unblock more than 200 bundles at once' });
    }

    const Bundle = require('../models/Bundle');
    let unblocked = 0;
    const errors = [];

    for (const id of ids) {
      try {
        const bundle = Bundle.findById(id);
        if (!bundle) { errors.push(`${id}: not found`); continue; }
        Bundle.unblock(id);
        logAdminAction(ACTIONS.UNBLOCK_BUNDLE, req, 'bundle', id, `/b/${bundle.slug} - "${bundle.title}"`, {
          slug: bundle.slug, bulk: true
        });
        unblocked++;
      } catch (err) {
        errors.push(`${id}: ${err.message}`);
      }
    }

    res.json({ success: true, unblocked, errors });
  }

}

module.exports = AdminController;