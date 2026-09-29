const fs = require('fs');
const paths = require('../../../config/paths');
const configService = require('../../../services/configService');
const requirePermission = require('../../../middleware/requirePermission');
const { createMockRequest, createMockResponse, createMockNext } = require('../../setup/testHelpers');

function makeReq({ userId = null, user = null, acceptsHtml = true } = {}) {
  const req = createMockRequest({ session: { userId } });
  req.user = user;
  req.accepts = jest.fn((type) => type === 'html' ? acceptsHtml : false);
  return req;
}

function run(permission, reqOpts) {
  const req = makeReq(reqOpts);
  const res = createMockResponse();
  const next = createMockNext();
  requirePermission(permission)(req, res, next);
  return { req, res, next };
}

afterEach(() => {
  fs.rmSync(paths.ROLES_PATH, { force: true });
  configService.reload();
});

describe('requirePermission middleware', () => {
  // Ported from the isPremium cases, with roles in place of tiers.

  describe('unauthenticated requests without the permission', () => {
    it('redirects to /login for HTML requests', () => {
      const { res, next } = run('uploadFiles', { acceptsHtml: true });

      expect(res.redirect).toHaveBeenCalledWith('/login');
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 JSON for API requests', () => {
      const { res, next } = run('uploadFiles', { acceptsHtml: false });

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Authentication required' })
      );
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('unauthenticated requests with the permission', () => {
    it('calls next() when the anonymous role has the permission', () => {
      const { next, res } = run('createUrls', {});

      expect(next).toHaveBeenCalled();
      expect(res.redirect).not.toHaveBeenCalled();
    });

    it('stops anonymous visitors once the operator revokes the permission', () => {
      fs.writeFileSync(paths.ROLES_PATH, JSON.stringify({ roles: { anonymous: { permissions: { createUrls: false } } } }));
      configService.reload();

      const { next, res } = run('createUrls', { acceptsHtml: false });

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });
  });

  describe('roles with the permission', () => {
    it('calls next() for admin users regardless of role', () => {
      const { next, res } = run('uploadFiles', { userId: 1, user: { id: 1, isAdmin: 1, role: null } });

      expect(next).toHaveBeenCalled();
      expect(res.redirect).not.toHaveBeenCalled();
    });

    it('calls next() for trusted users', () => {
      const { next } = run('uploadFiles', { userId: 2, user: { id: 2, isAdmin: 0, role: 'trusted' } });
      expect(next).toHaveBeenCalled();
    });

    it('calls next() for unlimited users', () => {
      const { next } = run('uploadFiles', { userId: 3, user: { id: 3, isAdmin: 0, role: 'unlimited' } });
      expect(next).toHaveBeenCalled();
    });
  });

  describe('roles without the permission', () => {
    it('redirects to / for HTML requests (no upgrade wording)', () => {
      const { res, next } = run('uploadFiles', { userId: 4, user: { id: 4, isAdmin: 0, role: 'user' }, acceptsHtml: true });

      expect(res.redirect).toHaveBeenCalledWith('/');
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 403 JSON naming the permission for API requests', () => {
      const { res, next } = run('uploadFiles', { userId: 4, user: { id: 4, isAdmin: 0, role: 'user' }, acceptsHtml: false });

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'permission_denied', permission: 'uploadFiles' })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 403 JSON when the user object is null but a session exists', () => {
      const { res, next } = run('uploadFiles', { userId: 5, user: null, acceptsHtml: false });

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('treats a legacy tier value as the default role', () => {
      const { res, next } = run('uploadFiles', { userId: 6, user: { id: 6, isAdmin: 0, role: null, tier: 'pro' }, acceptsHtml: false });

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });
  });

  it('answers /api/ requests with JSON even when they accept anything (fetch sends */*)', () => {
    const req = makeReq({ userId: 4, user: { id: 4, isAdmin: 0, role: 'user' }, acceptsHtml: true });
    req.originalUrl = '/api/files/upload';
    const res = createMockResponse();
    const next = createMockNext();

    requirePermission('uploadFiles')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it('answers anonymous /api/ requests with 401 JSON rather than a login redirect', () => {
    const req = makeReq({ acceptsHtml: true });
    req.originalUrl = '/api/files';
    const res = createMockResponse();

    requirePermission('uploadFiles')(req, res, createMockNext());

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it('throws at setup time for an unknown permission', () => {
    expect(() => requirePermission('flyToMoon')).toThrow(/Unknown permission/);
  });
});
