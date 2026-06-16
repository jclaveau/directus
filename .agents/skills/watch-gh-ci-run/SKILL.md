---
name: watch-gh-ci-run
description:
  Wait for a GitHub Actions workflow run to finish, emitting one event per job as it lands and a final RUN_COMPLETE with
  the overall conclusion. Use right after `git push` to babysit CI without polling — events arrive as
  `<task-notification>` messages from the Monitor tool. On failure, the skill points at logs/artifacts; diagnosis is the
  user's call.
version: 1.0.0
---

# watch-gh-ci-run

Babysits a single GitHub Actions workflow run via the Monitor tool. Each completed job is one event; the workflow's
overall completion is one final event. No `sleep` loops in the conversation; the harness wakes you on each event.

## When to use

- Right after `git push` — confirm CI passed before moving on (memory: `feedback_watch_ci_after_push`).
- When the user asks "watch CI" / "check CI" mid-flow.
- After a rerun (`gh run rerun <id> --failed`).

Not for:

- Cross-branch / cross-workflow audits — use `gh run list` directly.
- Local CI reproduction — different skill.

## Procedure

### 1. Resolve the run id

After a push:

```sh
git push origin <branch> 2>&1 | tail -3
sleep 6
gh run list --repo <owner/repo> --branch <branch> --workflow=<workflow.yml> --limit 3 \
  --json databaseId,headSha,status \
  --jq '.[] | select(.headSha | startswith("<sha-prefix>")) | .databaseId'
```

- `<sha-prefix>` is the 6+ char prefix of the commit you just pushed (`git rev-parse --short HEAD`).
- Specify `--workflow=<file.yml>` when the repo has multiple workflows on the branch; otherwise drop the flag.
- The `sleep 6` is intentional — GitHub needs a few seconds to materialize the run after the push event.

If the user pinned a specific run id, skip this step.

### 2. Arm the Monitor

The polling loop lives in `watch-ci.sh` alongside this skill; the Monitor invocation just hands it the run id + repo.

```js
Monitor({
	description: 'CI jobs landing on PR #N sha <short-sha>',
	persistent: true,
	timeout_ms: 3_600_000, // 1h covers most workflows; raise if needed
	command: '.agents/skills/watch-gh-ci-run/watch-ci.sh <RUN_ID> <owner/repo>',
});
```

Optional third arg is the poll interval in seconds (default `45`). Drop it lower (e.g. `15`) only when you actually need
sub-minute granularity — gh API rate limits favor 30–60s.

Why this shape:

- The script emits only the _newly completed_ jobs each tick (`comm -13 <(prev) <(cur)`), so each task-notification
  carries one or two delta lines, not the full job list every poll.
- Emit-on-completion (not on every status change) avoids `queued` / `in_progress` / `waiting` noise.
- `persistent: true` survives the long tail of slow vendors; the script self-terminates with a final
  `RUN_COMPLETE: <conclusion>` line.
- Script exits `0` on success, `1` otherwise — Monitor surfaces both as `completed` and you decide what to do based on
  the final line.

### 3. React to events

Each `<task-notification>` contains one line of the form `<job-name>: <conclusion>`, or the terminal
`RUN_COMPLETE: <conclusion>`.

- **`success`** — acknowledge in one line ("X ✅"). No `PushNotification` (routine).
- **`failure`** — fetch the job log immediately and report the assertion details (next section). `PushNotification` only
  if the user is away and the failure changes what they'd do next.
- **`cancelled`** — usually means a newer push superseded this run, or the workflow timeout fired. Verify before action.
- **`RUN_COMPLETE`** — summarize the matrix and stop. Don't re-arm.

### 4. Diagnose a failure

```sh
gh run view <RUN_ID> --repo <owner/repo> --json jobs \
  --jq '.jobs[] | select(.name=="<failed-job>") | .databaseId'
# Then:
gh api repos/<owner/repo>/actions/jobs/<job-id>/logs > /tmp/<vendor>-job.log
```

The raw log is large; filter with `awk` (memory: `feedback_prefer_awk_over_sed`):

```sh
awk 'tolower($0) ~ /exit code|##\[error\]|directus.*failed|unhandled rejection/' /tmp/<vendor>-job.log \
  | grep -viE 'sdk build|api build|\[CJS\]|\[ESM\]|file copy|tsserver|workspace' \
  | tail -30
```

For deeper failures (need server logs, traces), grab the artifact:

```sh
gh api repos/<owner/repo>/actions/runs/<RUN_ID>/artifacts --jq '.artifacts[] | select(.name | test("<vendor>"))'
gh api repos/<owner/repo>/actions/artifacts/<artifact-id>/zip > /tmp/logs.zip
unzip -p /tmp/logs.zip <log-file>.txt | awk '/<pattern>/'
```

(memory: `feedback_use_pnpm_in_monorepo` — `pnpm dlx` over `npx` if a CLI is needed.)

### 5. Handle re-pushes mid-watch

If the user pushes a new commit while a Monitor is running:

1. Stop the old Monitor with `TaskStop <task-id>`. The old run will be cancelled by GitHub's concurrency rule (most
   workflows have `cancel-in-progress: true`); if not, decide whether to wait for it.
2. Resolve the new run id (step 1) and arm a fresh Monitor with the new id in the command.

Don't leave two Monitors running on the same workflow — events from both will arrive interleaved.

### 6. Fallback heartbeat

Monitor takes care of waking you on events, but if the gh poll loop ever stalls (network blip, transient API outage)
you'd wait forever. Pair it with a `ScheduleWakeup` fallback:

```js
ScheduleWakeup({
	delaySeconds: 1500,
	reason: 'Fallback heartbeat in case the gh-poll monitor stalls',
	prompt: '/loop check CI on PR #N (<owner/repo>, latest HEAD). ...',
});
```

The wakeup is a safety net, not the primary signal. With a Monitor armed, lean 1200–1800s — past the prompt-cache 5-min
window but cheap because it rarely fires.

## Common gotchas

- **Workflow timeout vs job cancellation** — `cancelled` on the last vendor while others succeeded usually means
  `timeout-minutes` in the workflow hit, not your code. Check `startedAt`/`completedAt` deltas in the json — if it's
  exactly 60min, that's the workflow timeout.
- **Don't poll outside the Monitor** — once the Monitor is armed, do other work or wait. Manual `gh run view` calls in
  the same conversation just burn context without surfacing anything new.
- **Concurrency cancel-in-progress** — many workflows include `concurrency: { cancel-in-progress: true }`. A fresh push
  aborts the old run; the Monitor will see `cancelled` for whatever was still running. That's expected, not a failure to
  investigate.
- **Two `_cache`-style hazards in CI** — `pnpm deploy --prod` produces non-symlinked copies of workspace packages, so
  module-level singletons can desync between runtime contexts. Diagnose with `gh api repos/.../jobs/.../logs` if you see
  "doesn't provide an export named X" or "ELOOP".

## Quick reference

```sh
# 1. After push: resolve run id (sha prefix from `git rev-parse --short HEAD`)
gh run list --repo <owner/repo> --branch <branch> --workflow=<file.yml> --limit 3 \
  --json databaseId,headSha,status --jq '.[] | select(.headSha|startswith("<sha>")) | .databaseId'

# 2. Arm the Monitor (wraps watch-ci.sh — see step 2 for the full call).
.agents/skills/watch-gh-ci-run/watch-ci.sh <run-id> <owner/repo>

# 3. On failure event, pull the job log:
gh api repos/<owner/repo>/actions/jobs/<job-id>/logs > /tmp/job.log
awk '/##\[error\]|exit code|failed/' /tmp/job.log | tail -30

# 4. On re-push, stop the old monitor:
TaskStop <task-id>
```

## What this skill does NOT do

- **Does not apply fixes.** Diagnose, propose, ask. (memory: `feedback_propose_before_applying`,
  `feedback_questions_never_trigger_edits`.)
- **Does not trigger reruns automatically.** `gh run rerun --failed` is a user decision — it consumes CI minutes and can
  mask flakes.
- **Does not babysit non-GitHub CI.** GitLab / Buildkite / Circle need their own monitors.
- **Does not chain across pushes.** One push → one Monitor → one outcome. A new push needs a fresh Monitor on the fresh
  run id.
