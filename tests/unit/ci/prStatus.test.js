const { desiredLabel, syncPullRequest, run, LABELS } = require('../../../.github/scripts/prStatus');

const notFound = () => Object.assign(new Error('Not Found'), { status: 404 });

// Minimal stand-in for actions/github-script's `github` client.
function fakeGithub({ labelsOnPr = [], existingRepoLabels = Object.keys(LABELS), openPrs = [], prs = {}, ciRuns = [] } = {}) {
  const repoLabels = new Set(existingRepoLabels);
  const prLabels = new Set(labelsOnPr);
  return {
    prLabels,
    repoLabels,
    rest: {
      issues: {
        listLabelsOnIssue: jest.fn(async () => ({ data: [...prLabels].map(name => ({ name })) })),
        addLabels: jest.fn(async ({ labels }) => labels.forEach(l => prLabels.add(l))),
        removeLabel: jest.fn(async ({ name }) => prLabels.delete(name)),
        getLabel: jest.fn(async ({ name }) => { if (!repoLabels.has(name)) throw notFound(); return { data: { name } }; }),
        createLabel: jest.fn(async ({ name }) => repoLabels.add(name))
      },
      pulls: {
        get: jest.fn(async ({ pull_number }) => ({ data: prs[pull_number] })),
        list: jest.fn(async () => ({ data: openPrs }))
      },
      actions: {
        listWorkflowRuns: jest.fn(async () => ({ data: { workflow_runs: ciRuns } }))
      }
    }
  };
}

const repo = { owner: 'o', repo: 'r' };
const pr = (overrides = {}) => ({ number: 7, draft: false, head: { sha: 'abc' }, ...overrides });

describe('desiredLabel', () => {
  it.each([
    [{ draft: true, ciConclusion: 'success' }, 'work-in-progress'],
    [{ draft: true, ciConclusion: 'failure' }, 'work-in-progress'],
    [{ draft: false, ciConclusion: 'success' }, 'ready-to-test'],
    [{ draft: false, ciConclusion: 'failure' }, 'needs-fixes'],
    [{ draft: false, ciConclusion: 'timed_out' }, 'needs-fixes'],
    [{ draft: false, ciConclusion: null }, null], // CI still running
    [{ draft: false, ciConclusion: 'cancelled' }, null]
  ])('%o → %p', (input, expected) => {
    expect(desiredLabel(input)).toBe(expected);
  });
});

describe('syncPullRequest', () => {
  it('adds the label and removes the stale one', async () => {
    const github = fakeGithub({ labelsOnPr: ['needs-fixes', 'bug'] });

    await syncPullRequest({ github, ...repo, pr: pr(), ciConclusion: 'success' });

    expect([...github.prLabels].sort()).toEqual(['bug', 'ready-to-test']);
  });

  it('creates a missing label first', async () => {
    const github = fakeGithub({ existingRepoLabels: [] });

    await syncPullRequest({ github, ...repo, pr: pr({ draft: true }), ciConclusion: null });

    expect(github.rest.issues.createLabel).toHaveBeenCalledWith(expect.objectContaining({
      name: 'work-in-progress', color: LABELS['work-in-progress'].color
    }));
    expect([...github.prLabels]).toEqual(['work-in-progress']);
  });

  it('clears status labels while CI is still running', async () => {
    const github = fakeGithub({ labelsOnPr: ['ready-to-test'] });

    await syncPullRequest({ github, ...repo, pr: pr(), ciConclusion: null });

    expect([...github.prLabels]).toEqual([]);
  });

  it('changes nothing when the label is already right', async () => {
    const github = fakeGithub({ labelsOnPr: ['ready-to-test'] });

    await syncPullRequest({ github, ...repo, pr: pr(), ciConclusion: 'success' });

    expect(github.rest.issues.addLabels).not.toHaveBeenCalled();
    expect(github.rest.issues.removeLabel).not.toHaveBeenCalled();
  });
});

describe('run', () => {
  it('on a pull_request_target event, uses the latest CI run for the head commit', async () => {
    const github = fakeGithub({ ciRuns: [{ status: 'completed', conclusion: 'failure', head_sha: 'abc' }] });
    const context = { eventName: 'pull_request_target', repo, payload: { pull_request: pr() } };

    await run({ github, context });

    expect(github.rest.actions.listWorkflowRuns).toHaveBeenCalledWith(expect.objectContaining({ workflow_id: 'ci.yml', head_sha: 'abc' }));
    expect([...github.prLabels]).toEqual(['needs-fixes']);
  });

  it('on a finished CI run, labels its pull requests', async () => {
    const github = fakeGithub({ prs: { 7: pr() } });
    const context = {
      eventName: 'workflow_run',
      repo,
      payload: { workflow_run: { conclusion: 'success', head_sha: 'abc', pull_requests: [{ number: 7 }] } }
    };

    await run({ github, context });

    expect([...github.prLabels]).toEqual(['ready-to-test']);
  });

  it('finds fork pull requests by head commit (GitHub leaves pull_requests empty for forks)', async () => {
    const github = fakeGithub({ openPrs: [pr({ number: 9, head: { sha: 'fork1' } }), pr({ number: 10, head: { sha: 'other' } })] });
    const context = {
      eventName: 'workflow_run',
      repo,
      payload: { workflow_run: { conclusion: 'failure', head_sha: 'fork1', pull_requests: [] } }
    };

    await run({ github, context });

    expect(github.rest.issues.addLabels).toHaveBeenCalledTimes(1);
    expect(github.rest.issues.addLabels).toHaveBeenCalledWith(expect.objectContaining({ issue_number: 9, labels: ['needs-fixes'] }));
  });

  it('ignores a CI result for a commit the pull request has moved past', async () => {
    const github = fakeGithub({ prs: { 7: pr({ head: { sha: 'newer' } }) }, labelsOnPr: [] });
    const context = {
      eventName: 'workflow_run',
      repo,
      payload: { workflow_run: { conclusion: 'success', head_sha: 'abc', pull_requests: [{ number: 7 }] } }
    };

    await run({ github, context });

    expect(github.rest.issues.addLabels).not.toHaveBeenCalled();
  });
});
