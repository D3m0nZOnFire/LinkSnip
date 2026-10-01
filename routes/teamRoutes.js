const express = require('express');
const router = express.Router();
const TeamController = require('../controllers/teamController');
const { isAuthenticated, isAdmin } = require('../middleware/auth');

// Teams (mounted behind features.teams in app.js). Who may do what is decided in services/teamService.js.
router.get('/teams', isAuthenticated, TeamController.listPage);
router.get('/teams/:id', isAuthenticated, TeamController.teamPage);
router.get('/admin/teams', isAuthenticated, isAdmin, TeamController.adminPage);

router.post('/api/teams', isAuthenticated, TeamController.create);
router.patch('/api/teams/:id', isAuthenticated, TeamController.rename);
router.delete('/api/teams/:id', isAuthenticated, TeamController.remove);
router.post('/api/teams/:id/invites', isAuthenticated, TeamController.invite);
router.post('/api/teams/:id/leave', isAuthenticated, TeamController.leave);
router.patch('/api/teams/:id/members/:userId', isAuthenticated, TeamController.changeRole);
router.delete('/api/teams/:id/members/:userId', isAuthenticated, TeamController.removeMember);

router.delete('/api/team-invites/:id', isAuthenticated, TeamController.revokeInvite);
router.post('/api/team-invites/:id/accept', isAuthenticated, TeamController.acceptInvite);
router.post('/api/team-invites/:id/decline', isAuthenticated, TeamController.declineInvite);

module.exports = router;
