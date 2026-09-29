const express = require('express');
const router = express.Router();
const db = require('../config/database');

// Liveness check for Docker's HEALTHCHECK and CI: the app answers and SQLite responds.
router.get('/healthz', (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok' });
  } catch (error) {
    console.error('Health check failed:', error.message);
    res.status(503).json({ status: 'error' });
  }
});

module.exports = router;
