const express = require('express');
const request = require('supertest');
const db = require('../../../config/database');

function makeApp() {
  const app = express();
  app.use(require('../../../routes/healthRoutes'));
  return app;
}

describe('GET /healthz', () => {
  it('answers 200 when the database responds', async () => {
    const res = await request(makeApp()).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('answers 503 when the database does not', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(db, 'prepare').mockImplementationOnce(() => { throw new Error('database is locked'); });

    const res = await request(makeApp()).get('/healthz');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'error' });
  });

  it('is never cached', async () => {
    const res = await request(makeApp()).get('/healthz');
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
