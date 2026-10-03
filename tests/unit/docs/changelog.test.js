const fs = require('fs');
const path = require('path');

// CHANGELOG.md (Keep a Changelog) is where release notes start: every version in package.json has its section,
// newest first, with what to do when upgrading.
const root = path.join(__dirname, '../../..');
const changelog = () => fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
const { version } = require('../../../package.json');

const HEADING = /^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})$/gm;
const versions = () => [...changelog().matchAll(HEADING)].map(m => ({ version: m[1], date: m[2] }));
const newer = (a, b) => {
  const [x, y] = [a, b].map(v => v.split('.').map(Number));
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

function section(v) {
  const text = changelog();
  const start = text.indexOf(`## [${v}]`);
  const next = text.indexOf('\n## [', start + 1);
  return text.slice(start, next === -1 ? undefined : next);
}

describe('CHANGELOG.md', () => {
  it('follows Keep a Changelog and Semantic Versioning', () => {
    const text = changelog();
    expect(text.startsWith('# Changelog\n')).toBe(true);
    expect(text).toContain('https://keepachangelog.com/');
    expect(text).toContain('https://semver.org/');
  });

  it(`has a section for package.json's version (${version})`, () => {
    expect(versions().map(v => v.version)).toContain(version);
  });

  it('starts with that version (nothing newer than what package.json says)', () => {
    expect(versions()[0].version).toBe(version);
  });

  it('lists every version once, newest first, with a real date', () => {
    const list = versions();
    expect(list.length).toBeGreaterThanOrEqual(5); // 1.0.0 to 1.4.0
    expect(new Set(list.map(v => v.version)).size).toBe(list.length);
    for (let i = 1; i < list.length; i++) {
      expect(newer(list[i - 1].version, list[i].version)).toBeGreaterThan(0);
      expect(list[i - 1].date >= list[i].date).toBe(true);
    }
    list.forEach(({ date }) => expect(Number.isNaN(Date.parse(date))).toBe(false));
  });

  it('says what to do when upgrading, for every version after the first', () => {
    versions().slice(0, -1).forEach(({ version: v }) => expect(section(v)).toMatch(/^### Upgrading$/m));
  });

  it('links every version to its changes on GitHub', () => {
    const text = changelog();
    versions().forEach(({ version: v }) =>
      expect(text).toMatch(new RegExp(`^\\[${v.replace(/\./g, '\\.')}\\]: https://github\\.com/D3m0nZOnFire/LinkSnip/(compare|releases/tag)/`, 'm')));
  });
});
