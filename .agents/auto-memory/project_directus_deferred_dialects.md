---
name: project_directus_deferred_dialects
description: Only postgres gates a PR on this fork — sqlite3 and maria are "deferred dialects" covered by standing ci-dialect-* branches/PRs plus tracker issues #330/#331; settled decisions behind PR #328
metadata:
  type: project
---

**Postgres is the only dialect gating a PR.** sqlite3 and maria are *deferred*: their
failures are triaged after the merge, not before it.

- **Why not just widen the PR matrix:** at 8 shards a vendor, two vendors is 16 jobs.
  Measured queue waits — 10 jobs → 3-38s; **16 jobs → 277/301/310s** on three pg
  shards, because sqlite jobs took the slots pg needed. Runner minutes are free here
  (jean: "it's a free repo … our only goal is shorten the CI loop"), wall clock is not.
- **Why not `push:` on the trunk:** `blackbox.yml`'s push trigger lists `main` and
  `v11.10.1-prepare`, **not** `v11.10.1-hhh-dev` — so nothing ran the other dialects
  post-merge either. Dropping sqlite3 from the PR matrix dropped it entirely until
  this was built. Adding hhh-dev there would fire all 3 dialects at once = 24 jobs.
- **The mechanism:** one standing branch per deferred dialect, `ci-dialect-<vendor>`,
  carrying a single no-op commit that names it in `.github/ci-dialect`. `blackbox.yml`
  reads that file to build a one-vendor matrix; `blackbox-pr.yml` runs a
  `ci-dialect-*` head with no label. `refresh-dialect-ci.yml` (push to hhh-dev only)
  rebuilds each branch on the new tip and force-pushes → `pull_request: synchronize`
  → 8 jobs for that dialect alone. Standing PRs **#332** (SQLite) / **#333** (MariaDB),
  label `deferred dialect`, **do not merge**.
- **Two load-bearing details:** the branch is *regenerated* (`checkout -B <br>
  origin/<trunk>`), never rebased, so no conflict is possible — a conflicting PR is
  `mergeable=CONFLICTING`, which stops every `pull_request` workflow *silently*. And
  the push uses `COMPOSE_SSH_KEY`: a push made with `GITHUB_TOKEN` creates no workflow
  runs, so the branch would move and no matrix would start.
- **Issues #330 / #331** are the permanent per-dialect inboxes (label `deferred
  dialect`, stay open). Intended wiring — CI comments the failing tests + shard +
  commit + uploads artifacts, since Actions logs expire and the force-push replaces
  the PRs' check history. **NOT BUILT YET.**

**Settled — do NOT re-raise:** sqlite3 losing per-PR coverage is deliberate; a
"background PR" for failures was rejected in favour of an issue (a PR with no diff is
an issue with extra steps); `continue-on-error` was rejected because a neutral check
is one nobody reads.

Related: [[project_directus_blackbox_sharding]], [[reference_gha_push_pr_double_run]].
