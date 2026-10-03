const AuthController = require('../../../controllers/authController');
const { safeNext } = require('../../../controllers/authController');
const { createTestUser, createMockRequest, createMockResponse } = require('../../setup/testHelpers');

// /login?next=/f/abc (a restricted file sends visitors there) returns them to that page after logging in.
// Only addresses on this site: anything else would be an open redirect.

describe('safeNext', () => {
  it('keeps a path on this site', () => {
    expect(safeNext('/f/abc')).toBe('/f/abc');
    expect(safeNext('/p/x?confirmed=1')).toBe('/p/x?confirmed=1');
  });

  it('drops anything that could leave the site', () => {
    for (const value of ['//evil.example', 'https://evil.example', '/\\evil.example', '\\\\evil', 'javascript:alert(1)', '', null, undefined, ['/a']]) {
      expect(safeNext(value)).toBeNull();
    }
  });
});

describe('login', () => {
  const call = async (handler, req) => {
    const res = createMockResponse();
    await handler(createMockRequest({ get: () => '', ...req }), res);
    return res;
  };

  it('the form carries next', async () => {
    const res = await call(AuthController.getLogin, { query: { next: '/f/abc' } });
    expect(res._viewData.next).toBe('/f/abc');
    expect((await call(AuthController.getLogin, { query: { next: '//evil.example' } }))._viewData.next).toBeNull();
  });

  it('goes back to next after logging in, else to the dashboard', async () => {
    await createTestUser({ username: 'alice', password: 'password123' });
    let res = await call(AuthController.postLogin, { body: { username: 'alice', password: 'password123', next: '/f/abc' } });
    expect(res._redirectUrl).toBe('/f/abc');
    res = await call(AuthController.postLogin, { body: { username: 'alice', password: 'password123', next: 'https://evil.example' } });
    expect(res._redirectUrl).toBe('/dashboard');
  });

  it('keeps next when the password is wrong', async () => {
    await createTestUser({ username: 'alice', password: 'password123' });
    const res = await call(AuthController.postLogin, { body: { username: 'alice', password: 'nope', next: '/f/abc' } });
    expect(res._viewData.next).toBe('/f/abc');
  });
});

describe('audit log', () => {
  const { getTestDatabase } = require('../../setup/testDatabase');
  const entry = (action) => getTestDatabase().prepare('SELECT userId, username FROM audit_logs WHERE action = ? ORDER BY id DESC').get(action);

  it('a login is logged with the account it logged into', async () => {
    const user = await createTestUser({ username: 'alice', password: 'password123' });
    const res = createMockResponse();
    await AuthController.postLogin(createMockRequest({ get: () => '', body: { username: 'alice', password: 'password123' } }), res);
    expect(entry('LOGIN_SUCCESS')).toEqual({ userId: user.id, username: 'alice' });
  });

  it('so is a registration', async () => {
    const res = createMockResponse();
    await AuthController.postRegister(createMockRequest({ get: () => '',
      body: { username: 'newbie', email: '', password: 'password123', confirmPassword: 'password123' } }), res);
    expect(entry('REGISTER')).toEqual({ userId: expect.any(Number), username: 'newbie' });
  });
});

it('a wrong password for an existing account is logged against that account', async () => {
  const { getTestDatabase } = require('../../setup/testDatabase');
  const user = await createTestUser({ username: 'alice', password: 'password123' });
  await AuthController.postLogin(createMockRequest({ get: () => '', body: { username: 'alice', password: 'nope' } }), createMockResponse());
  expect(getTestDatabase().prepare("SELECT userId FROM audit_logs WHERE action = 'LOGIN_FAILED'").get()).toEqual({ userId: user.id });
});
