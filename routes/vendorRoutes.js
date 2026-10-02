const path = require('path');
const express = require('express');
const router = express.Router();

// Third-party browser code served by LinkSnip itself, so pages make no requests to a CDN. One file per route:
// nothing else in node_modules is reachable.
// (the package's exports don't list the UMD build: take it from the folder of its main file)
const CHART_JS = path.join(path.dirname(require.resolve('chart.js')), 'chart.umd.js');

router.get('/vendor/chart.umd.js', (req, res) => {
  res.type('application/javascript');
  res.sendFile(CHART_JS, { maxAge: '7d' });
});

module.exports = router;
