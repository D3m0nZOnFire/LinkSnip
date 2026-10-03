const path = require('path');
const express = require('express');
const request = require('supertest');
const sameOrigin = require('../../../middleware/sameOrigin');

function makeApp() {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '../../../views'));
  app.use(sameOrigin);
  app.all('/{*any}', (req, res) => res.json({ ok: true }));
  return app;
}

describe('sameOrigin (cross-site request protection)', () => {
  let app;
  beforeEach(() => { app = makeApp(); });

  describe('safe methods are never checked', () => {
    it.each(['get', 'head', 'options'])('%s from another site passes', async (method) => {
      const res = await request(app)[method]('/dashboard')
        .set('Origin', 'https://evil.example')
        .set('Sec-Fetch-Site', 'cross-site');
      expect(res.status).toBe(200);
    });
  });

  describe('browsers sending Sec-Fetch-Site', () => {
    it.each(['same-origin', 'none'])('%s passes', async (site) => {
      const res = await request(app).post('/create').set('Sec-Fetch-Site', site);
      expect(res.status).toBe(200);
    });

    it.each(['cross-site', 'same-site'])('%s is refused', async (site) => {
      const res = await request(app).post('/create').set('Sec-Fetch-Site', site);
      expect(res.status).toBe(403);
    });

    it('same-origin passes even when a proxy rewrote the Host header', async () => {
      const res = await request(app).post('/create')
        .set('Sec-Fetch-Site', 'same-origin')
        .set('Origin', 'https://links.example.com');
      expect(res.status).toBe(200);
    });

    it('cross-site is refused even with a matching Origin', async () => {
      const res = await request(app).post('/create')
        .set('Host', 'links.example.com')
        .set('Sec-Fetch-Site', 'cross-site')
        .set('Origin', 'https://links.example.com');
      expect(res.status).toBe(403);
    });
  });

  describe('without Sec-Fetch-Site (older browsers, plain http)', () => {
    it('an Origin matching the host passes', async () => {
      const res = await request(app).post('/create')
        .set('Host', 'links.example.com')
        .set('Origin', 'https://links.example.com');
      expect(res.status).toBe(200);
    });

    it('a matching Origin with a port passes', async () => {
      const res = await request(app).post('/create')
        .set('Host', 'localhost:8081')
        .set('Origin', 'http://localhost:8081');
      expect(res.status).toBe(200);
    });

    it('an Origin from another host is refused', async () => {
      const res = await request(app).post('/create')
        .set('Host', 'links.example.com')
        .set('Origin', 'https://evil.example');
      expect(res.status).toBe(403);
    });

    it('the same host on another port is refused', async () => {
      const res = await request(app).post('/create')
        .set('Host', 'localhost:8081')
        .set('Origin', 'http://localhost:9999');
      expect(res.status).toBe(403);
    });

    it('Origin "null" (sandboxed frame, data: page) is refused', async () => {
      const res = await request(app).post('/create').set('Origin', 'null');
      expect(res.status).toBe(403);
    });

    it('no Origin and no Sec-Fetch-Site (curl, scripts) passes', async () => {
      const res = await request(app).post('/api/files/upload');
      expect(res.status).toBe(200);
    });
  });

  it.each(['put', 'patch', 'delete'])('%s is checked like POST', async (method) => {
    const res = await request(app)[method]('/api/urls/1').set('Sec-Fetch-Site', 'cross-site');
    expect(res.status).toBe(403);
  });

  it('API requests get JSON', async () => {
    const res = await request(app).delete('/api/urls/1')
      .set('Origin', 'https://evil.example')
      .set('Accept', 'text/html');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: 'cross_site_request',
      message: expect.any(String)
    });
  });

  it('pages get the error page', async () => {
    const res = await request(app).post('/logout')
      .set('Origin', 'https://evil.example')
      .set('Accept', 'text/html');
    expect(res.status).toBe(403);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('Error 403');
  });
});
