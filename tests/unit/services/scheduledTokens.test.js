const ScheduledTasks = require('../../../services/scheduledTasks');
const UserToken = require('../../../models/UserToken');
const { getTestDatabase } = require('../../setup/testDatabase');
const { createTestUser } = require('../../setup/testHelpers');

// Nightly (5:00, with the share links): one-time mail links that ended more than a day ago are deleted.

it('cleanupExpiredTokens removes old mail links and keeps open ones', async () => {
  const log = jest.spyOn(console, 'log').mockImplementation(() => {});
  const user = await createTestUser({ username: 'ann' });
  UserToken.create(user.id, 'reset_password', { ttlMinutes: 30 });
  UserToken.create(user.id, 'verify_email', { email: 'a@example.com', ttlMinutes: 30 });
  getTestDatabase().prepare("UPDATE user_tokens SET expiresAt = '2000-01-01T00:00:00.000Z' WHERE purpose = 'verify_email'").run();

  ScheduledTasks.cleanupExpiredTokens();

  expect(getTestDatabase().prepare('SELECT purpose FROM user_tokens').all()).toEqual([{ purpose: 'reset_password' }]);
  log.mockRestore();
});
