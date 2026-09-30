const fs = require('fs');
const path = require('path');
const { renderConfigurationDoc } = require('../../../scripts/generate-config-docs');
const schema = require('../../../config/schema');

const DOC = path.join(__dirname, '../../../docs/CONFIGURATION.md');

describe('docs/CONFIGURATION.md', () => {
  it('is up to date with config/schema.js (run: npm run docs:config)', () => {
    expect(fs.readFileSync(DOC, 'utf8')).toBe(renderConfigurationDoc());
  });

  it('documents every setting, permission and limit with its description', () => {
    const doc = renderConfigurationDoc();
    for (const [key, spec] of Object.entries(schema.SETTINGS)) {
      expect(doc).toContain(`\`${key}\``);
      expect(doc).toContain(spec.description);
    }
    for (const [name, description] of [...Object.entries(schema.PERMISSIONS), ...Object.entries(schema.LIMITS)]) {
      expect(doc).toContain(`\`${name}\``);
      expect(doc).toContain(description);
    }
  });

  it('shows the default permission of every built-in role', () => {
    const doc = renderConfigurationDoc();
    expect(doc).toMatch(/\| `uploadFiles` \|[^\n]*\| ✗ \| ✗ \| ✓ \| ✓ \|/);
    expect(doc).toMatch(/\| `urlsPerHour` \|[^\n]*\| 10 \| 100 \| 500 \| unlimited \|/);
  });

  it('explains the local country lookup: DB-IP credit, no IPs sent, what to do offline', () => {
    const doc = renderConfigurationDoc();
    expect(doc).toMatch(/DB-IP Lite/);
    expect(doc).toMatch(/CC BY 4\.0/);
    expect(doc).toMatch(/Visitor IPs never leave the server/);
    expect(doc).toMatch(/Without outbound access/);
    expect(doc).not.toMatch(/ip-api/);
  });
});
