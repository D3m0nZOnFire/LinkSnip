const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');

// Chart.js is served by LinkSnip itself (no request to a CDN): /vendor/chart.umd.js from node_modules.

const app = express();
app.use(require('../../../routes/vendorRoutes'));

it('serves Chart.js as JavaScript, cached by the browser', async () => {
  const res = await request(app).get('/vendor/chart.umd.js');
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toMatch(/javascript/);
  expect(res.headers['cache-control']).toMatch(/max-age=\d+/);
  expect(res.text).toMatch(/Chart\.js v4\./);
});

it('serves nothing else from node_modules', async () => {
  expect((await request(app).get('/vendor/../package.json')).status).toBe(404);
  expect((await request(app).get('/vendor/chart.js')).status).toBe(404);
});

it('no page loads Chart.js from a CDN any more', () => {
  const views = path.join(__dirname, '../../../views');
  for (const file of fs.readdirSync(views).filter(f => f.endsWith('.ejs'))) {
    const source = fs.readFileSync(path.join(views, file), 'utf8');
    expect({ file, cdn: /cdn\.jsdelivr\.net\/npm\/chart\.js/.test(source) }).toEqual({ file, cdn: false });
  }
});
