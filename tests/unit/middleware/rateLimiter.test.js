const fs = require('fs');
const express = require('express');
const request = require('supertest');
const paths = require('../../../config/paths');
const configService = require('../../../services/configService');
const { createRoleLimiter } = require('../../../middleware/rateLimiter');

function setRolesFile(data) {
  fs.writeFileSync(paths.ROLES_PATH, JSON.stringify(data));
  configService.reload();
}

// Test app: the x-user header stands in for the session + attachUser middleware.
function makeApp(limiter) {
  const app = express();
  app.use((req, res, next) => {
    const header = req.get('x-user');
    const user = header ? JSON.parse(header) : null;
    req.user = user;
    req.session = user ? { userId: user.id, isAdmin: !!user.isAdmin } : {};
    next();
  });
  app.post('/create', limiter, (req, res) => res.json({ ok: true }));
  return app;
}

async function hit(app, times, user) {
  const statuses = [];
  for (let i = 0; i < times; i++) {
    const req = request(app).post('/create');
    if (user) req.set('x-user', JSON.stringify(user));
    statuses.push((await req).status);
  }
  return statuses;
}

afterEach(() => {
  fs.rmSync(paths.ROLES_PATH, { force: true });
  configService.reload();
});

describe('createRoleLimiter', () => {
  it('limits anonymous visitors by the anonymous role limit', async () => {
    setRolesFile({ roles: { anonymous: { limits: { urlsPerHour: 2 } } } });
    const app = makeApp(createRoleLimiter('urlsPerHour', { prefix: 'url', noun: 'links' }));

    expect(await hit(app, 3)).toEqual([200, 200, 429]);
  });

  it('limits a user by their role and keys the count per user', async () => {
    setRolesFile({ roles: { user: { limits: { urlsPerHour: 1 } }, trusted: { limits: { urlsPerHour: 2 } } } });
    const app = makeApp(createRoleLimiter('urlsPerHour', { prefix: 'url', noun: 'links' }));

    expect(await hit(app, 2, { id: 1, role: 'user' })).toEqual([200, 429]);
    expect(await hit(app, 2, { id: 2, role: null })).toEqual([200, 429]);
    expect(await hit(app, 3, { id: 3, role: 'trusted' })).toEqual([200, 200, 429]);
  });

  it('treats a null limit as unlimited', async () => {
    setRolesFile({ roles: { user: { limits: { urlsPerHour: null } } } });
    const app = makeApp(createRoleLimiter('urlsPerHour', { prefix: 'url', noun: 'links' }));

    expect(await hit(app, 5, { id: 1 })).toEqual([200, 200, 200, 200, 200]);
  });

  it('treats a limit of 0 as none allowed', async () => {
    setRolesFile({ roles: { anonymous: { limits: { pastesPerHour: 0 } } } });
    const app = makeApp(createRoleLimiter('pastesPerHour', { prefix: 'paste', noun: 'pastes' }));

    expect(await hit(app, 1)).toEqual([429]);
  });

  it('lets admins bypass the limit', async () => {
    setRolesFile({ roles: { user: { limits: { urlsPerHour: 1 } } } });
    const app = makeApp(createRoleLimiter('urlsPerHour', { prefix: 'url', noun: 'links' }));

    expect(await hit(app, 3, { id: 9, isAdmin: 1 })).toEqual([200, 200, 200]);
  });

  it('applies an edited limit without a restart', async () => {
    setRolesFile({ roles: { user: { limits: { urlsPerHour: 1 } } } });
    const app = makeApp(createRoleLimiter('urlsPerHour', { prefix: 'url', noun: 'links' }));
    expect(await hit(app, 2, { id: 1 })).toEqual([200, 429]);

    // Both earlier hits count (the rejected one too), so a limit of 3 leaves room for one more.
    // Under the old limit of 1 this would be [429, 429].
    setRolesFile({ roles: { user: { limits: { urlsPerHour: 3 } } } });
    expect(await hit(app, 2, { id: 1 })).toEqual([200, 429]);
  });

  it('returns a JSON 429 with the limit, without upgrade wording', async () => {
    setRolesFile({ roles: { anonymous: { limits: { urlsPerHour: 1 } } } });
    const app = makeApp(createRoleLimiter('urlsPerHour', { prefix: 'url', noun: 'links' }));
    await hit(app, 1);

    const res = await request(app).post('/create');

    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/1 links per hour/);
    expect(res.body.error).not.toMatch(/upgrade|pro|premium/i);
    expect(res.body.retryAfter).toEqual(expect.any(Number));
  });
});
