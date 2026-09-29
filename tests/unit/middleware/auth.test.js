const { isAuthenticated, isAdmin, attachUser } = require('../../../middleware/auth');
const { createTestUser, createMockRequest, createMockResponse, createMockNext } = require('../../setup/testHelpers');
const { getTestDatabase } = require('../../setup/testDatabase');

describe('Auth Middleware', () => {
  describe('isAuthenticated', () => {
    it('should call next() when session has userId', () => {
      const req = createMockRequest({
        session: { userId: 1 }
      });
      const res = createMockResponse();
      const next = createMockNext();

      isAuthenticated(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.redirect).not.toHaveBeenCalled();
    });

    it('should redirect to /login when not authenticated', () => {
      const req = createMockRequest({
        session: {}
      });
      const res = createMockResponse();
      const next = createMockNext();

      isAuthenticated(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.redirect).toHaveBeenCalledWith('/login');
    });

    it('should redirect when session is undefined', () => {
      const req = createMockRequest();
      req.session = undefined;
      const res = createMockResponse();
      const next = createMockNext();

      isAuthenticated(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/login');
    });
  });

  describe('isAdmin', () => {
    it('should call next() when user is admin', () => {
      const req = createMockRequest({
        session: { userId: 1, isAdmin: true }
      });
      const res = createMockResponse();
      const next = createMockNext();

      isAdmin(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.redirect).not.toHaveBeenCalled();
    });

    it('should redirect to / when user is not admin', () => {
      const req = createMockRequest({
        session: { userId: 1, isAdmin: false }
      });
      const res = createMockResponse();
      const next = createMockNext();

      isAdmin(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/');
    });

    it('should redirect when session has no userId', () => {
      const req = createMockRequest({
        session: { isAdmin: true }
      });
      const res = createMockResponse();
      const next = createMockNext();

      isAdmin(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/');
    });

    it('should redirect when session is undefined', () => {
      const req = createMockRequest();
      req.session = undefined;
      const res = createMockResponse();
      const next = createMockNext();

      isAdmin(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/');
    });
  });

  describe('attachUser', () => {
    it('should attach user to request when session has userId', async () => {
      const user = await createTestUser({ username: 'attachtest' });
      const req = createMockRequest({
        session: { userId: user.id }
      });
      const res = createMockResponse();
      const next = createMockNext();

      attachUser(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user).toBeDefined();
      expect(req.user.username).toBe('attachtest');
    });

    it('should update lastActive timestamp', async () => {
      const user = await createTestUser({ username: 'lastactive' });
      const req = createMockRequest({
        session: { userId: user.id }
      });
      const res = createMockResponse();
      const next = createMockNext();

      // Get initial lastActive (should be null)
      const db = getTestDatabase();
      const before = db.prepare('SELECT lastActive FROM users WHERE id = ?').get(user.id);

      attachUser(req, res, next);

      // Check lastActive was updated
      const after = db.prepare('SELECT lastActive FROM users WHERE id = ?').get(user.id);
      expect(after.lastActive).not.toBeNull();
    });

    it('should call next() without attaching user when no session', () => {
      const req = createMockRequest();
      req.session = undefined;
      const res = createMockResponse();
      const next = createMockNext();

      attachUser(req, res, next);

      expect(next).toHaveBeenCalled();
      // req.user remains as initialized in mock (null)
      expect(req.user).toBeNull();
    });

    it('should call next() without attaching user when no userId in session', () => {
      const req = createMockRequest({
        session: {}
      });
      const res = createMockResponse();
      const next = createMockNext();

      attachUser(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user).toBeNull();
    });
  });
});
