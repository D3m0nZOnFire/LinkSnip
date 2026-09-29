/**
 * Keeps one status label on each pull request, from its draft state and CI result:
 *
 *   work-in-progress  draft PR
 *   ready-to-test     CI green and not a draft: safe for the maintainer to try
 *   needs-fixes       CI failed: the author has work to do
 *
 * While CI is still running (or was cancelled) none of the three is shown.
 * Called from .github/workflows/pr-status.yml via actions/github-script.
 */

const CI_WORKFLOW = 'ci.yml';

const LABELS = {
  'work-in-progress': { color: 'fbca04', description: 'Draft pull request' },
  'ready-to-test': { color: '0e8a16', description: 'CI passed and not a draft: ready for the maintainer to try' },
  'needs-fixes': { color: 'd93f0b', description: 'CI failed: the author has work to do' }
};

const FAILED = ['failure', 'timed_out', 'startup_failure', 'action_required'];

function desiredLabel({ draft, ciConclusion }) {
  if (draft) return 'work-in-progress';
  if (ciConclusion === 'success') return 'ready-to-test';
  if (FAILED.includes(ciConclusion)) return 'needs-fixes';
  return null;
}

async function ensureLabel(github, owner, repo, name) {
  try {
    await github.rest.issues.getLabel({ owner, repo, name });
  } catch (error) {
    if (error.status !== 404) throw error;
    await github.rest.issues.createLabel({ owner, repo, name, ...LABELS[name] });
  }
}

async function syncPullRequest({ github, owner, repo, pr, ciConclusion }) {
  const desired = desiredLabel({ draft: pr.draft, ciConclusion });
  const { data } = await github.rest.issues.listLabelsOnIssue({ owner, repo, issue_number: pr.number });
  const current = data.map(l => l.name).filter(name => name in LABELS);

  for (const name of current) {
    if (name !== desired) await github.rest.issues.removeLabel({ owner, repo, issue_number: pr.number, name });
  }
  if (desired && !current.includes(desired)) {
    await ensureLabel(github, owner, repo, desired);
    await github.rest.issues.addLabels({ owner, repo, issue_number: pr.number, labels: [desired] });
  }
}

/** Conclusion of the latest CI run for a commit, or null while none has finished. */
async function latestCiConclusion({ github, owner, repo, sha }) {
  const { data } = await github.rest.actions.listWorkflowRuns({ owner, repo, workflow_id: CI_WORKFLOW, head_sha: sha, per_page: 1 });
  const latest = data.workflow_runs[0];
  return latest && latest.status === 'completed' ? latest.conclusion : null;
}

async function run({ github, context }) {
  const { owner, repo } = context.repo;

  if (context.eventName === 'workflow_run') {
    const ciRun = context.payload.workflow_run;
    // GitHub leaves pull_requests empty for PRs from forks; match those by head commit.
    const prs = ciRun.pull_requests.length
      ? await Promise.all(ciRun.pull_requests.map(async ({ number }) =>
        (await github.rest.pulls.get({ owner, repo, pull_number: number })).data))
      : (await github.rest.pulls.list({ owner, repo, state: 'open', per_page: 100 })).data
        .filter(pr => pr.head.sha === ciRun.head_sha);

    for (const pr of prs) {
      if (pr.head.sha !== ciRun.head_sha) continue; // a newer push has its own run
      await syncPullRequest({ github, owner, repo, pr, ciConclusion: ciRun.conclusion });
    }
    return;
  }

  // pull_request_target: opened, reopened, synchronize, ready_for_review, converted_to_draft
  const pr = context.payload.pull_request;
  const ciConclusion = await latestCiConclusion({ github, owner, repo, sha: pr.head.sha });
  await syncPullRequest({ github, owner, repo, pr, ciConclusion });
}

module.exports = { run, desiredLabel, syncPullRequest, latestCiConclusion, LABELS };
