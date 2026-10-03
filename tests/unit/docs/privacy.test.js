const fs = require('fs');
const path = require('path');
const { SETTINGS } = require('../../../config/schema');

// docs/PRIVACY.md names settings an operator changes to keep less data; a renamed key must not leave it wrong
const root = path.join(__dirname, '../../..');
const privacy = () => fs.readFileSync(path.join(root, 'docs/PRIVACY.md'), 'utf8');

describe('docs/PRIVACY.md', () => {
  it('is linked from the README', () => {
    expect(fs.readFileSync(path.join(root, 'README.md'), 'utf8')).toContain('(docs/PRIVACY.md)');
  });

  it('names only settings that exist', () => {
    const named = [...privacy().matchAll(/`((?:features|geo|retention|anonymous|access|registration)\.[A-Za-z]+)`/g)].map(m => m[1]);
    expect(named.length).toBeGreaterThan(3);
    named.forEach(key => expect(SETTINGS).toHaveProperty([key]));
  });

  it('covers the analytics switch and the retention settings', () => {
    const text = privacy();
    ['features.analytics', 'retention.analyticsDays', 'retention.auditLogDays', 'geo.enabled'].forEach(key =>
      expect(text).toContain(`\`${key}\``));
  });
});
