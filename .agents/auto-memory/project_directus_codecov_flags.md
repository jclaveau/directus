---
name: project_directus_codecov_flags
description:
  This fork's codecov runs per-package patch flags; blackbox coverage is NOT in the api unit flag, so blackbox-only code
  fails codecov/patch/api
metadata:
  type: project
---

Codecov on jclaveau/directus PRs posts a `codecov/patch/<pkg>` + `codecov/project/<pkg>` per workspace package. Patch
target = auto ≈ project% (~68%), not 100% (no `codecov.yml` in repo). `compose`/`compose-hhh-main` always fails
(App-token lacks `workflows`) — ignore.

- **Blackbox coverage is NOT uploaded to the `api` (unit) flag.** Code exercised only by `tests/blackbox` shows as
  uncovered patch under `codecov/patch/api`. New api logic needs real **unit** tests (knex-mock-client) to clear patch.
- Seen on #46 (batch-insert): the per-dialect `CapabilitiesHelper` overrides
  (`api/src/database/helpers/capabilities/dialects/*`) and the `createMany` batchInsert/per-row dispatch were
  blackbox-only → patch/api red. Fixed with `capabilities.test.ts` (all dialect methods) + `createMany` unit tests
  (batch vs per-row vs empty).
- #50 (skip-noop): a new `@directus/constants` barrel line `export * from './items.js'` was the uncovered patch line
  until the test imported `ALTERATIONS_KEYS` _through_ `./index.js` instead of the leaf.

**How to apply:** before pushing an api/constants PR here, run the changed package's coverage locally and intersect
uncovered lines with the diff; expect blackbox-covered paths to still need unit tests. General mechanics in
[[reference_codecov_patch_coverage]]. CI gate context in [[project_directus_fork_integration_branches]].

**Read a FLAG's absolute coverage per commit via the codecov API** (the commit endpoint has no flag breakdown; the
report endpoint filtered by flag does):
```
curl -s "https://api.codecov.io/api/v2/github/jclaveau/repos/directus/report/?sha=<FULL_SHA>&flag=blackbox" \
  | python3 -c "import sys,json;t=json.load(sys.stdin)['totals'];print(t['coverage'],t['lines'],t['hits'])"
```
Used to prove sharding preserved coverage: `blackbox` flag 43.04% pre-shard vs 43.05% post — the union of sharded
partial uploads equals the full-run coverage (codecov merges by flag server-side). See [[project_directus_blackbox_sharding]].
