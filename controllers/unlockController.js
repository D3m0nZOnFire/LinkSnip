const bcrypt = require('bcrypt');
const Url = require('../models/Url');

/**
 * Show password entry page for protected URL
 */
exports.showUnlockPage = (req, res) => {
  const { slug } = req.params;

  // Find the URL
  const url = Url.findBySlug(slug);

  if (!url) {
    return res.status(404).render('error', {
      message: 'Short link not found',
      statusCode: 404
    });
  }

  // Check if URL is valid (not expired, not maxed out, not blocked)
  const { valid, reason } = Url.isValid(url);
  if (!valid) {
    return res.status(410).render('error', {
      message: reason,
      statusCode: 410
    });
  }

  // Check if password is required
  if (!url.password) {
    // No password required, redirect directly
    return res.redirect(`/s/${slug}`);
  }

  // Render unlock page
  res.render('unlock', {
    user: req.user || null,
    slug,
    fullShortUrl: `${req.protocol}://${req.get('host')}/s/${slug}`,
    error: null
  });
};

/**
 * Process password submission and unlock URL
 */
exports.unlockUrl = async (req, res) => {
  const { slug } = req.params;
  const { password, remember } = req.body;

  // Find the URL
  const url = Url.findBySlug(slug);

  if (!url) {
    return res.status(404).render('error', {
      message: 'Short link not found',
      statusCode: 404
    });
  }

  // Check if URL is valid
  const { valid, reason } = Url.isValid(url);
  if (!valid) {
    return res.status(410).render('error', {
      message: reason,
      statusCode: 410
    });
  }

  // Check if password is required
  if (!url.password) {
    // No password required, redirect directly
    return res.redirect(`/s/${slug}`);
  }

  // Verify password
  try {
    const isPasswordCorrect = await bcrypt.compare(password, url.password);

    if (!isPasswordCorrect) {
      // Wrong password
      return res.render('unlock', {
        user: req.user || null,
        slug,
        fullShortUrl: `${req.protocol}://${req.get('host')}/s/${slug}`,
        error: 'Incorrect password. Please try again.'
      });
    }

    // Password correct - store in session if remember is checked
    if (remember === '1') {
      // Initialize unlocked URLs array in session if it doesn't exist
      if (!req.session.unlockedUrls) {
        req.session.unlockedUrls = [];
      }

      // Add this URL to unlocked list (if not already there)
      if (!req.session.unlockedUrls.includes(url.id)) {
        req.session.unlockedUrls.push(url.id);
      }
    }

    // Set a temporary flag for this redirect
    req.session.tempUnlock = url.id;

    // Redirect to the short URL (which will now allow access)
    res.redirect(`/s/${slug}`);

  } catch (error) {
    console.error('Password verification error:', error);
    res.status(500).render('error', {
      message: 'An error occurred while verifying the password',
      statusCode: 500
    });
  }
};
