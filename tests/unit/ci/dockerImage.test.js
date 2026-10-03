const fs = require('fs');
const path = require('path');

// Image tags: every release is published as :X.Y.Z, :X.Y, :X (and :latest). docker-compose.yml follows :1 by default,
// so `docker compose pull` brings 1.x updates but never a 2.0 with breaking changes.
const root = path.join(__dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

describe('docker-publish.yml', () => {
  const workflow = read('.github/workflows/docker-publish.yml');

  it.each([
    'type=semver,pattern={{version}}',
    'type=semver,pattern={{major}}.{{minor}}',
    'type=semver,pattern={{major}}',
    'type=raw,value=latest'
  ])('tags the image with %s', (tag) => {
    expect(workflow).toContain(tag);
  });
});

describe('docker-compose.yml', () => {
  const compose = read('docker-compose.yml');

  it('uses the :1 image unless LINKSNIP_VERSION pins another', () => {
    expect(compose).toContain('image: ghcr.io/d3m0nzonfire/linksnip:${LINKSNIP_VERSION:-1}');
    expect(compose).not.toMatch(/linksnip:latest/);
  });

  it('can still build from the checkout (git pull && docker compose up -d --build)', () => {
    expect(compose).toMatch(/^\s+build: \.$/m);
  });
});
