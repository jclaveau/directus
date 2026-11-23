#!/usr/bin/env bash
# Write "queued" into a PR's admin-preview block while its Preview Admin run
# waits for a GitHub-hosted runner.
#
# The workflow publishes the block itself, but only once a runner picks the job
# up; until then the block still shows the previous run, so a contended preview
# looks like one that never starts. Nothing on GitHub can write meanwhile (a job
# doing it would queue too), so the session that pushed runs this.
#
#   preview-queued.sh 758
#   → ⏳ queued since 10:27 UTC, no runner yet: 20 jobs waiting on the
#     account, longest 349s, then deployed ~1m46s after a runner takes it
#     (median of 10 past deploys) · [run 45156321958](…)
#
# The block carries the queued run's id as its owner marker: when that run
# boots, its "claimed" publish replaces the block, and a superseded run's
# "cancelled" leaves it alone (the workflow's own ownership rule).
# Left as is: no queued preview run for the PR head, or a run already started.
#
# Usage: preview-queued.sh <pr> [owner/repo]   (default repo jclaveau/directus)

set -euo pipefail

pr_number="${1:?usage: preview-queued.sh <pr> [owner/repo]}"
repository="${2:-jclaveau/directus}"

head_sha=$(gh api "repos/$repository/pulls/$pr_number" --jq '.head.sha')

queued_run=$(gh api \
	"repos/$repository/actions/workflows/preview-admin.yml/runs?head_sha=$head_sha&per_page=20" \
	--jq '[.workflow_runs[]
		| select(.status == "queued" or .status == "waiting"
			or .status == "pending" or .status == "requested")]
		| sort_by(.created_at) | last // empty | "\(.id) \(.html_url)"')

if [ -z "$queued_run" ]; then
	echo "no queued preview run for $head_sha: block left as is"
	exit 0
fi

run_id=${queued_run%% *}
run_url=${queued_run#* }

job_state=$(gh api "repos/$repository/actions/runs/$run_id/jobs" \
	--jq '.jobs[] | select(.name == "preview") | "\(.status) \(.created_at)"')

job_status=${job_state%% *}

# A job the runner has not taken yet reads queued, or pending / waiting while
# a concurrency group or an environment holds it.
case "$job_status" in
	queued | pending | waiting) ;;
	*)
		echo "run $run_id job is ${job_status:-absent}: the run owns the block"
		exit 0
		;;
esac

queued_since=${job_state#* }

contention_report=$(bash "$HOME/.agents/scripts/gha-contention.sh" "$repository" || true)

RUN_ID="$run_id" RUN_URL="$run_url" PR_NUMBER="$pr_number" \
REPOSITORY="$repository" HEAD_SHA="$head_sha" QUEUED_SINCE="$queued_since" \
CONTENTION_REPORT="$contention_report" python3 -I - <<'PYTHON'
import json
import os
import re
import subprocess
from datetime import datetime

def call_github(*gh_arguments, request_body=None):
	return subprocess.run(
		['gh', 'api', *gh_arguments],
		input=request_body, capture_output=True, text=True, check=True,
	).stdout

run_id = os.environ['RUN_ID']
report = os.environ['CONTENTION_REPORT']
waiting_match = re.search(r'(\d+) waiting for a hosted runner', report)
longest_match = re.search(r'longest a queued job has waited: (\d+)s', report)

if waiting_match is None or longest_match is None:
	raise SystemExit(
		'gha-contention.sh printed no queue summary, got '
		+ json.dumps(report[-400:]),
	)

queued_clock = datetime.fromisoformat(
	os.environ['QUEUED_SINCE'].replace('Z', '+00:00'),
).strftime('%H:%M UTC')

# The workflow's own deploy ETA reads the same steps: its "deploying" step
# start to its "deployed" publish, over the last past previews.
def parse_stamp(stamp_text):
	return datetime.fromisoformat(stamp_text.replace('Z', '+00:00')).timestamp()

listed_runs = json.loads(call_github(
	f"repos/{os.environ['REPOSITORY']}/actions/workflows/preview-admin.yml/runs?per_page=100",
))['workflow_runs']
booted_runs = [
	listed_run for listed_run in listed_runs
	if listed_run['conclusion'] != 'skipped' and str(listed_run['id']) != run_id
]
deploy_durations = []
for listed_run in booted_runs[:30]:
	run_jobs = json.loads(call_github(
		f"repos/{os.environ['REPOSITORY']}/actions/runs/{listed_run['id']}/jobs",
	))['jobs']
	job_steps = {
		job_step['name']: job_step
		for run_job in run_jobs if run_job['name'] == 'preview'
		for job_step in run_job['steps']
	}
	deploying_step = job_steps.get('Mark the preview deploying in the PR description')
	deployed_step = job_steps.get('Mark the preview deployed in the PR description')
	if deploying_step is None or deployed_step is None \
			or deployed_step['conclusion'] != 'success':
		continue
	deploy_durations.append(
		parse_stamp(deployed_step['completed_at'])
		- parse_stamp(deploying_step['started_at']),
	)
	if len(deploy_durations) == 10:
		break

state_line = (
	f"⏳ queued since {queued_clock}, no runner yet:"
	f" {waiting_match.group(1)} jobs waiting on the account,"
	f" longest {longest_match.group(1)}s"
)
if deploy_durations:
	deploy_durations.sort()
	median_seconds = round(deploy_durations[len(deploy_durations) // 2])
	state_line += (
		f", then deployed ~{median_seconds // 60}m{median_seconds % 60:02d}s"
		f" after a runner takes it (median of {len(deploy_durations)} past deploys)"
	)

preview_block = '\n'.join([
	'<!-- admin-preview:start -->',
	f"### 🔎 Preview admin — `{os.environ['HEAD_SHA']}`",
	'',
	f"- **State:** {state_line} · [run {run_id}]({os.environ['RUN_URL']})",
	'- The run replaces this block with its link once a runner picks it up.',
	'- [ ] 🔄 Re-run admin preview',
	f"<!-- admin-preview:run={run_id} -->",
	'<!-- admin-preview:end -->',
])

pull_path = f"repos/{os.environ['REPOSITORY']}/pulls/{os.environ['PR_NUMBER']}"
pr_body = call_github(pull_path, '--jq', '.body // ""').removesuffix('\n')
block_pattern = re.compile(
	r'<!-- admin-preview:start -->.*?<!-- admin-preview:end -->', re.S,
)

job_status = call_github(
	f"repos/{os.environ['REPOSITORY']}/actions/runs/{run_id}/jobs",
	'--jq', '.jobs[] | select(.name == "preview") | .status',
).strip()

# The runner may have picked the job up since the first check: its own publish
# then holds the block, and "queued" would overwrite "deploying".
if job_status not in ('queued', 'pending', 'waiting'):
	print(f"run {run_id} job is {json.dumps(job_status)} now: block left as is")
	raise SystemExit(0)

if block_pattern.search(pr_body):
	new_body = block_pattern.sub(lambda _: preview_block, pr_body)
elif pr_body.strip():
	new_body = pr_body.rstrip() + '\n\n' + preview_block
else:
	new_body = preview_block

# gh pr edit trips this repo's classic-Projects GraphQL bug: PATCH via REST.
call_github(
	'-X', 'PATCH', pull_path, '--input', '-',
	request_body=json.dumps({'body': new_body}),
)
print(f"run {run_id}: {state_line}")
PYTHON
