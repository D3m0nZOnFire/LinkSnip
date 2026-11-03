/**
 * The 404 page: for addresses that match no route, and for items a visitor may not know exist (private items).
 * One function, so the two can't be told apart.
 */
function sendNotFound(req, res) {
  res.status(404).render('error', {
    title: 'Page Not Found',
    message: 'The page you are looking for does not exist.',
    code: 404
  });
}

module.exports = { sendNotFound };
