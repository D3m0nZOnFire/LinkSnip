const express = require('express');
const unlockController = require('../controllers/unlockController');
const { createUnlockLimiter } = require('../middleware/rateLimiter');

/**
 * Password unlock for every content type. Built by a factory so tests get a fresh limiter.
 * @param {object} options - { limiter: middleware from createUnlockLimiter() }
 */
function createUnlockRouter({ limiter = createUnlockLimiter() } = {}) {
  const router = express.Router();

  router.get('/unlock/:type/:slug', unlockController.showUnlockPage);
  router.post('/unlock/:type/:slug', limiter, unlockController.unlock);

  // Old per-type addresses (bookmarks, pages open during a deploy)
  const old = { '/unlock/:slug': 'url', '/unlock-bundle/:slug': 'bundle', '/unlock-paste/:slug': 'paste', '/unlock-file/:slug': 'file' };
  for (const [path, type] of Object.entries(old)) router.all(path, unlockController.redirectOld(type));

  return router;
}

module.exports = createUnlockRouter();
module.exports.createUnlockRouter = createUnlockRouter;
