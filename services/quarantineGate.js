/**
 * Visitor side of quarantine: a quarantined link or bundle shows a warning page
 * first. Choosing "Continue anyway" (?confirmed=1) is remembered in the session,
 * so the unlock flow for password-protected links doesn't ask twice.
 *
 * @returns {boolean} true when the warning page was rendered (the caller stops)
 */
function showQuarantineWarning(req, res, { type, item, destination, path, infoPath }) {
  if (!item.isQuarantined) return false;

  const key = `${type}:${item.id}`;
  const acknowledged = req.session.quarantineAck || [];
  if (req.query && req.query.confirmed === '1') {
    if (!acknowledged.includes(key)) req.session.quarantineAck = [...acknowledged, key];
    return false;
  }
  if (acknowledged.includes(key)) return false;

  res.render('quarantine', {
    user: req.user || null,
    kind: type === 'bundle' ? 'bundle' : 'link',
    destination,
    continueUrl: `${path}?confirmed=1`,
    infoUrl: infoPath || null
  });
  return true;
}

module.exports = { showQuarantineWarning };
