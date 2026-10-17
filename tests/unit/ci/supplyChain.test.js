const fs = require('fs');
const path = require('path');

// Supply chain: what CI runs and what the image is built from can't change under us without a reviewed PR.
// Actions are pinned to commit SHAs (a moved tag can't run new code), the Caddy image to an exact version, and
// Dependabot proposes the updates. Published images carry an SBOM and provenance; CI scans the image with Trivy.
const root = path.join(__dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const workflows = fs.readdirSync(path.join(root, '.github/workflows')).filter(f => f.endsWith('.yml'));

describe.each(workflows)('.github/workflows/%s', (file) => {
  const uses = [...read(`.github/workflows/${file}`).matchAll(/^\s*-?\s*uses:\s*(.+)$/gm)].map(m => m[1].trim());

  it('pins every action to a commit SHA, with its version as a comment', () => {
    uses.forEach(line => expect(line).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/));
  });
});

describe('docker-publish.yml', () => {
  const workflow = read('.github/workflows/docker-publish.yml');

  it('attaches an SBOM and full provenance to the image', () => {
    expect(workflow).toMatch(/^\s+sbom: true$/m);
    expect(workflow).toMatch(/^\s+provenance: mode=max$/m);
  });
});

describe('ci.yml', () => {
  const workflow = read('.github/workflows/ci.yml');

  it('scans the built image with Trivy and fails on fixable critical or high vulnerabilities', () => {
    const scan = workflow.slice(workflow.indexOf('aquasecurity/trivy-action'));
    expect(scan).toMatch(/image-ref: linksnip:ci/);
    expect(scan).toMatch(/severity: CRITICAL,HIGH/);
    expect(scan).toMatch(/exit-code: '1'/);
    expect(scan).toMatch(/ignore-unfixed: true/);
  });
});

describe('docker-compose.yml', () => {
  it('pins the Caddy image to an exact version', () => {
    expect(read('docker-compose.yml')).toMatch(/^\s+image: caddy:\d+\.\d+\.\d+$/m);
  });
});

describe('dependabot.yml', () => {
  const config = read('.github/dependabot.yml');

  it.each(['npm', 'github-actions', 'docker', 'docker-compose'])('updates %s', (ecosystem) => {
    expect(config).toMatch(new RegExp(`package-ecosystem: ${ecosystem}$`, 'm'));
  });
});
