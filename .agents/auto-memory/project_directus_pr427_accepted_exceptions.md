---
name: project_directus_pr427_accepted_exceptions
description: PR #427 (cover the upsert and update paths before batching) — settled points a fresh review would wrongly re-flag
metadata:
  type: project
---

Coverage-only PR preceding the #414 batching work, on branch
`v11.10.1-perf/batch-nested-inserts` (branch name kept from when it was going to be one
PR — renaming it would orphan the head ref and close the PR).

Settled, do **not** re-raise:

- **It touches `api/src/services/items.ts`.** Comments only — a TODO plus two notes
  recording why unreachable guards are kept. No behaviour change. The body says so.
- **The two dead arms stay.** jean ruled "keep and comment". The coarse-purge arm is the
  fail-safe that widens a purge when scope is unresolvable, dead only because a select
  happens to project exactly the fields read, with nothing tying the two lists together.
- **No issue filed for the read-hook 500.** jean ruled TODO-only. See
  [[project_directus_read_hook_return_unvalidated]].
- **`read-hook-null.test.ts` asserts a 500.** That is current behaviour deliberately
  pinned; if the TODO is fixed the test is supposed to fail.
- **Shard hints do not improve wall clock.** Deliberate and stated in the commit — see
  [[project_directus_blackbox_shard_weighting]].
- **`Refs #414`, not `Closes`.** This covers the paths; it does not make anything faster.
- **Two blackbox misses remain** (`onRequireUserIntegrityCheck` arm, filter-cancel
  throw). Unreachable over HTTP, both unit-covered. Nothing in the five methods is
  missed by both suites.
- **`updateBatch`'s `opts.onRequireUserIntegrityCheck` true-arm** needs updateBatch
  nested under another mutation; no controller does that.

Two flakes seen while landing it, neither reproducing: `cache-composed-path-scope`
failing to create its collection, and `schedule-hook` counting 4 scheduler fires
instead of 5 on sqlite3.
