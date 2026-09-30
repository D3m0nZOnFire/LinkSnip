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

    // The session is set at login; the database is the truth on every request after that
    describe('keeps the session in step with the database', () => {
      const run = (session) => {
        const req = createMockRequest({ session });
        const next = createMockNext();
        attachUser(req, createMockResponse(), next);
        return { req, next };
      };

      it('logs out a user who was banned after logging in', async () => {
        const user = await createTestUser({ username: 'banned', isBanned: 1 });
        const { req, next } = run({ userId: user.id, isAdmin: false });

        expect(next).toHaveBeenCalled();
        expect(req.user).toBeNull();
        expect(req.session.userId).toBeUndefined();
        expect(req.session.isAdmin).toBeUndefined();
      });

      it('does not mark a banned user as active', async () => {
        const user = await createTestUser({ username: 'banned', isBanned: 1 });
        run({ userId: user.id });
        expect(getTestDatabase().prepare('SELECT lastActive FROM users WHERE id = ?').get(user.id).lastActive).toBeNull();
      });

      it('logs out a session whose user no longer exists', () => {
        const { req, next } = run({ userId: 99999, isAdmin: true });

        expect(next).toHaveBeenCalled();
        expect(req.user).toBeNull();
        expect(req.session.userId).toBeUndefined();
        expect(req.session.isAdmin).toBeUndefined();
      });

      it('takes admin rights away from an admin who was demoted', async () => {
        const user = await createTestUser({ username: 'demoted', isAdmin: 0 });
        const { req } = run({ userId: user.id, isAdmin: true });

        expect(req.session.isAdmin).toBe(false);

        const next = createMockNext();
        const res = createMockResponse();
        isAdmin(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.redirect).toHaveBeenCalledWith('/');
      });

      it('gives admin rights to a user who was promoted', async () => {
        const user = await createTestUser({ username: 'promoted', isAdmin: 1 });
        const { req } = run({ userId: user.id, isAdmin: false });
        expect(req.session.isAdmin).toBe(true);
      });

      it('keeps other session data (unlocks, quarantine acknowledgments) when logging out', async () => {
        const user = await createTestUser({ username: 'banned', isBanned: 1 });
        const { req } = run({ userId: user.id, unlocked: { url: [3] } });
        expect(req.session.unlocked).toEqual({ url: [3] });
      });
    });
  });
});
