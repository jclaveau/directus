---
name: project_directus_blackbox_merge_coverage_pnpm12
description: Blackbox coverage silently never uploaded to Codecov from ~2026-09-24 (pnpm 12 implicit install strips devDeps → merge-coverage can't find istanbul-lib-coverage); fix PR #615 calls node directly; how to tell real vs carried-forward bb numbers
metadata:
  author: Jean Claveau
  type: project
---

Blackbox coverage did not reach Codecov from ~2026-09-24 (pnpm 12 bump) to 2026-10-16. Every `blackbox` flag figure in that span, on PR heads #571–#613 and trunk, was CARRIED FORWARD from older data.

**Cause:** `pnpm --filter tests-blackbox merge-coverage` runs an implicit install first (log: `Packages: -905`, devDependencies removed) → `Cannot find package 'istanbul-lib-coverage'`. Upload step is `continue-on-error`, so the job stays green. (Why the install goes production-mode is read from the log, not traced in pnpm.)

**Fix:** PR #615 changes both coverage steps in `blackbox.yml` to `node tests/blackbox/merge-coverage.mjs` (paths are absolute, works from root). Proven on #614: 8/8 real uploads.

**Second cause, same symptom:** a server killed mid-dump leaves a truncated `cov-*.json` → `SyntaxError: Unexpected end of JSON input` in merge-coverage.mjs → that shard uploads NOTHING (green job). Hit #614 shard 3 (shares.ts constructor and payload.ts:737 read as MISS though their suites passed). Fixed on #615 (7510fec5c1): dump writes `.partial` then renames; merge skips an unparsable dump with a warning and logs `merged N dumps, skipped M`.

**Why:** identical percentages across two shas = carried-forward tell (see [[project_directus_codecov_stale_flag]]); a trunk push runs no bb at all ([[project_directus_trunk_full_vendor_matrix]]).

**How to apply:** before trusting any per-file bb coverage, confirm the sha got real uploads (count of `blackbox` uploads == expected jobs); check the upload step's log, not its colour. A shard whose suites passed but left no coverage = check that shard's upload step (shard 3 on #614: truncated dump, see above). Merge #615 before #614 (stacked). Also see [[project_directus_blackbox_coverage]].
