---
name: project_directus_bind_limit_chunking_plan
description: Core chunking / PG 65535 bind-limit plan — fix lives in the knex fork (jclaveau/knex#10 arrayParameterThreshold, -1 = never), not per call site; #645 post-commit 500; non-PG → #610 point 9
metadata:
  author: Jean Claveau
  type: project
---

Chunking comes up in every review. Settled plan: fix it once in the knex fork, not with `chunk()` at each call site.

**Plan (issue jclaveau/knex#10, Directus #645, #610 point 9):**
- Fork `pg-querycompiler.js` rewrites a scalar `whereIn` to `= any($1)` only above a hardcoded 65535. Lower it to a client config `arrayParameterThreshold` (default 1000, domain `-1 | 1..maxBindParameters`).
- Per-call override: `whereIn('id', keys, { arrayParameterThreshold: n })`. `undefined`/`null` → client config; `-1` → never rewrite (matches Directus `limit: -1`); `0`, `-2`, `1.5`, NaN, `'1000'`, > maxBindParameters → TypeError naming the value.
- `batchInsert` caps rows at `floor(maxBindParameters / columns)` like `batchUpdate`'s `chunkRowsFor`; plus a readable error when compiled binds > 65535.
- NOT an env var: any T in 1..~60000 returns the same rows/plan, nothing for ops to tune.

**Why:** Directus has ~50 whereIn-family calls in 25 files plus apply-query `_in`; per-call opt-in leaves the forgotten one overflowing on a big real request. Jean wanted "never chunk" expressible, "always" is just 1.

**Settled:** T=1000 does NOT go in PR #643 (different repo, one goal per PR). Bump the knex pin on `v11.10.1-chore/knex-fork` after the fork lands, plus a blackbox `_in` >1000 on uuid/int/string PKs. #643 keeps its 10 000 chunk in `users.deleteMany` as snapshot-memory bound.

**#645:** `deleteMany` post-commit `snapshot([survivors])` (items.ts ~3418) is uncaught → 500 after delete committed + stale cache + no `items.delete` event. Fix = `.catch(() => null)` like `updateMany`. The `selfRelationSurvivorKeys` bind overflow (F+1)·N runs BEFORE the delete, so it rolls back (500, nothing stale) — my first claim that it 500s after commit was wrong.

**How to apply:** a reviewer raising "chunk this whereIn" → point at knex#10; don't add call-site chunking. Non-PG (SQLite 32766, MariaDB no rewrite) → #610 point 9. See [[project_directus_pr643_graphql_deny_cache_tables]], [[project_directus_knex_deepsort_regression]].
