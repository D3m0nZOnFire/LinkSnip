const bcrypt = require('bcrypt');
const { MIN_PASSWORD_LENGTH, passwordProblem } = require('../../../services/passwordPolicy');
const AuthController = require('../../../controllers/authController');
const UserController = require('../../../controllers/userController');
const AdminController = require('../../../controllers/adminController');
const { getTestDatabase } = require('../../setup/testDatabase');
const { createTestUser, createMockRequest, createMockResponse } = require('../../setup/testHelpers');

// One minimum for every new password: register, change password, setup, Admin → Users (create and edit), the CLI.
// Existing shorter passwords keep working: the rule applies when a password is set.

const SEVEN = 'abcdefg';
const EIGHT = 'abcdefgh';

describe('services/passwordPolicy', () => {
  it('is 8 characters', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8);
  });

  it('names the problem with a too short or missing password, and accepts a long enough one', () => {
    expect(passwordProblem(SEVEN)).toBe('Password must be at least 8 characters');
    expect(passwordProblem('')).toBe('Password must be at least 8 characters');
    expect(passwordProblem(undefined)).toBe('Password must be at least 8 characters');
    expect(passwordProblem(EIGHT)).toBeNull();
  });

  it('setup and the admin CLI use the same minimum', () => {
    expect(require('../../../services/setupService').MIN_PASSWORD).toBe(MIN_PASSWORD_LENGTH);
  });
});

async function call(handler, req) {
  const res = createMockResponse();
  await handler(createMockRequest({ get: () => '', ...req }), res);
  return res;
}

describe('register', () => {
  const register = (password) => call(AuthController.postRegister, {
    body: { username: 'newbie', email: '', password, confirmPassword: password }, session: {}
  });

  it('refuses 7 characters', async () => {
    const res = await register(SEVEN);
    expect(res._viewData.error).toBe('Password must be at least 8 characters');
  });

  it('accepts 8 characters', async () => {
    const res = await register(EIGHT);
    expect((res._viewData && res._viewData.error) || '').not.toMatch(/at least/);
  });
});

describe('changing your password (PUT /api/user/password)', () => {
  let user;
  beforeEach(async () => {
    const row = await createTestUser({ username: 'alice', password: 'old-password' });
    user = { id: row.id, username: 'alice', isAdmin: 0 };
  });
  const change = (newPassword) => call(UserController.updatePassword, {
    body: { currentPassword: 'old-password', newPassword }, user, session: { userId: user.id }
  });

  it('refuses 7 characters', async () => {
    const res = await change(SEVEN);
    expect(res.statusCode).toBe(400);
    expect(res._jsonData.error).toBe('Password must be at least 8 characters');
  });

  it('accepts 8 characters', async () => {
    const res = await change(EIGHT);
    expect(res.statusCode).toBe(200);
  });
});

describe('Admin → Users', () => {
  let admin;
  beforeEach(async () => {
    const row = await createTestUser({ username: 'boss', isAdmin: 1 });
    admin = { id: row.id, username: 'boss', isAdmin: 1 };
  });
  const asAdmin = (extra) => ({ user: admin, session: { userId: admin.id, isAdmin: true }, ...extra });

  it('creating a user refuses 7 characters and accepts 8', async () => {
    let res = await call(AdminController.createUser, asAdmin({ body: { username: 'short', password: SEVEN } }));
    expect(res.statusCode).toBe(400);
    expect(res._jsonData.error).toBe('Password must be at least 8 characters');
    res = await call(AdminController.createUser, asAdmin({ body: { username: 'long', password: EIGHT } }));
    expect(res.statusCode).not.toBe(400);
  });

  it('setting a new password while editing refuses 7 characters; leaving it empty keeps the old one', async () => {
    const target = await createTestUser({ username: 'target', password: 'old-password' });
    const edit = (body) => call(AdminController.updateUser, asAdmin({ params: { id: String(target.id) }, body }));

    let res = await edit({ password: SEVEN });
    expect(res.statusCode).toBe(400);
    expect(res._jsonData.error).toBe('Password must be at least 8 characters');
    const stored = () => getTestDatabase().prepare('SELECT password FROM users WHERE id = ?').get(target.id).password;
    expect(await bcrypt.compare('old-password', stored())).toBe(true);

    res = await edit({ email: 'target@example.com', password: '' });
    expect(res.statusCode).not.toBe(400);
    res = await edit({ password: EIGHT });
    expect(res.statusCode).not.toBe(400);
    expect(await bcrypt.compare(EIGHT, stored())).toBe(true);
  });
});

describe('the forms', () => {
  const fs = require('fs');
  const path = require('path');
  const read = (file) => fs.readFileSync(path.join(__dirname, '../../../', file), 'utf8');

  it('take the minimum from app.locals (minPasswordLength), never a number of their own', () => {
    expect(require('../../../middleware/viewLocals').appLocals().minPasswordLength).toBe(8);
    for (const view of ['views/register.ejs', 'views/settings.ejs', 'views/admin-users.ejs']) {
      expect(read(view)).not.toMatch(/minlength="\d+"/);
      expect(read(view)).toMatch(/minlength="<%= minPasswordLength %>"/);
    }
    expect(read('public/js/settings.js')).not.toMatch(/at least 6/);
  });
});
