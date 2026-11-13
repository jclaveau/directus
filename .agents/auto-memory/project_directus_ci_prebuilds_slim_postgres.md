---
name: project_directus_ci_prebuilds_slim_postgres
description: ci-prebuilds images measured NOT worth adopting on this fork (~0-5s/job); the real CI lever was the 645 MiB timescaledb-ha pull, replaced by a 204 MiB composite postgres image (PR #586)
metadata:
  author: Jean Claveau
  type: project
---

jclaveau/ci-prebuilds (runner images) rejected for this fork's CI: an image removes only ~10s/job of Prepare (pnpm/action-setup 8s + node setup ~2s); `pnpm install` (9s) and `pnpm run build` (43s) depend on lockfile/source. Pull costs 5s (alpine-dood-pnpm 148 MiB) to 10s (ubuntu 274 MiB) at ~28 MiB/s → net 0-5s on a ~646s slowest bb shard. Acceptance job's `playwright install chromium` (22-27s) would get SLOWER: prebuilt Playwright images are 720/887 MiB (all 3 browsers). Container jobs would also force `HOST_ADDRESS` rewriting (bb reaches PG/Redis/Directus on localhost).

**Why:** don't re-propose it. `-gyp` images also useless: argon2, isolated-vm, sqlite3, @parcel/watcher all find prebuilds (0 compile lines, <0.5s each); gyp matters only if a Node/libc change (alpine musl) forces source builds. CI actually runs Node 24.21.0 although package.json says `"node": "22"`.

**What worked (PR https://github.com/jclaveau/directus/pull/586, branch `v11.10.1-ci/slim-blackbox-postgres`):** most of each bb shard's 27-30s "Start database" was pulling `timescale/timescaledb-ha:pg18` (645 MiB, 21s). No off-the-shelf non-HA image has timescaledb + postgis, so `tests/blackbox/postgres-image/Dockerfile` = `postgis/postgis:18-3.6-alpine` + timescaledb 2.30.2's 3 `.so` + control/sql copied from `timescale/timescaledb:2.30.2-pg18` (musl-only deps, works). Published to `ghcr.io/jclaveau/blackbox-postgres:pg18-ts2.30.2-postgis3.6` by `build-images.yml` (next to the minio mirror, with smoke test of init.sql). Measured: pull 21s → ~9.6s, "Start database" 26-30s → 12-17s on 7/8 shards (shard 4 = 32s, outlier from pre-pull + two 5s healthcheck intervals, not the image). ~13s × 8 shards ≈ 1.7 runner-min per bb run; NOT a claimed wall-clock gain (test-step noise > 13s). All 8 PG shards green incl. hypertable + geometry suites.

**How to apply:** Renovate `enabledManagers` excludes docker, so bumping timescaledb/postgis is by hand (single `ARG`; tag names both versions → new tag, never overwrite). Worktree `../.wt-slim-pg`. Related: [[project_directus_blackbox_shard_weighting]], [[project_directus_trunk_full_vendor_matrix]].
