/**
 * lnksnp.ch/<slug> without the type's prefix opens the item at its real address (/s/, /b/, /p/, /f/). A slug may be
 * taken once per type: the registry order decides, so a link comes first. Items the visitor may not see (private)
 * are skipped, so they answer like a slug nobody uses. Mounted after every other route, right before the 404.
 */
const express = require('express');
const slugService = require('../services/slugService');
const { contentType, enabledTypes } = require('../services/contentTypes');
const { privateStatus } = require('../services/accessService');

const router = express.Router();

router.get('/:slug', (req, res, next) => {
  const { slug } = req.params;
  if (slugService.problem(slug)) return next();

  const user = req.user || null;
  for (const type of enabledTypes()) {
    const record = slugService.find(type, slug);
    if (!record || privateStatus(type, record, user)) continue;
    // The real address checks the rest (blocked, expired, password, …)
    const query = req.originalUrl.indexOf('?');
    const search = query === -1 ? '' : req.originalUrl.slice(query);
    return res.redirect(302, `${contentType(type).publicPrefix}${encodeURIComponent(record.slug)}${search}`);
  }
  return next();
});

module.exports = router;
