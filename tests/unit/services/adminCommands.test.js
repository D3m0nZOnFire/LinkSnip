const adminCommands = require('../../../services/adminCommands');
const User = require('../../../models/User');
const { getTestDatabase } = require('../../setup/testDatabase');
const { createTestUser } = require('../../setup/testHelpers');

const audit = (action) => getTestDatabase().prepare('SELECT * FROM audit_logs WHERE action = ?').all(action);

describe('adminCommands (npm run admin)', () => {
  describe('createAdmin', () => {
    it('creates an admin account', async () => {
      const user = await adminCommands.createAdmin('root', 'longenough');

      expect(user.isAdmin).toBe(1);
      expect(await User.verifyPassword('longenough', User.findByUsername('root').password)).toBe(true);
      expect(audit('CREATE_USER')).toHaveLength(1);
      expect(JSON.parse(audit('CREATE_USER')[0].details)).toEqual(expect.objectContaining({ via: 'cli', isAdmin: true }));
    });

    it('refuses a taken username', async () => {
      await createTestUser({ username: 'root' });
      await expect(adminCommands.createAdmin('root', 'longenough')).rejects.toThrow(/already exists/i);
    });

    it('refuses a short password or empty username', async () => {
      await expect(adminCommands.createAdmin('root', 'short')).rejects.toThrow(/8 characters/);
      await expect(adminCommands.createAdmin('  ', 'longenough')).rejects.toThrow(/username/i);
    });
  });

  describe('promote', () => {
    it('makes an existing user an admin', async () => {
      await createTestUser({ username: 'alice', isAdmin: 0 });

      const user = adminCommands.promote('alice');

      expect(user.isAdmin).toBe(1);
      expect(audit('GRANT_ADMIN')).toHaveLength(1);
    });

    it('refuses an unknown user', () => {
      expect(() => adminCommands.promote('ghost')).toThrow(/No user named "ghost"/);
    });

    it('says so when the user already is an admin', async () => {
      await createTestUser({ username: 'alice', isAdmin: 1 });
      expect(() => adminCommands.promote('alice')).toThrow(/already an admin/);
    });
  });

  describe('resetPassword', () => {
    it("replaces the user's password", async () => {
      await createTestUser({ username: 'alice', password: 'oldpassword' });

      await adminCommands.resetPassword('alice', 'newpassword1');

      const hash = User.findByUsername('alice').password;
      expect(await User.verifyPassword('newpassword1', hash)).toBe(true);
      expect(await User.verifyPassword('oldpassword', hash)).toBe(false);
      expect(JSON.parse(audit('UPDATE_USER')[0].details)).toEqual({ passwordReset: true, via: 'cli' });
    });

    it('refuses an unknown user or a short password', async () => {
      await createTestUser({ username: 'alice' });
      await expect(adminCommands.resetPassword('ghost', 'newpassword1')).rejects.toThrow(/No user named/);
      await expect(adminCommands.resetPassword('alice', 'short')).rejects.toThrow(/8 characters/);
    });
  });
});
