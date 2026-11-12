---
name: project_directus_pr643_graphql_deny_cache_tables
description: PR #643 (fixes #642) — 9 raw-written cache tables added to SYSTEM_DENY_LIST; autoreview widened it to the unregistered scoped_cache_pending_purges table and three raw system-table writes with no purge
metadata:
  author: Jean Claveau
  type: project
---

PR #643 puts the 9 cache telemetry/audit system collections (`directus_cache_stats_*`, `directus_cache_audits`, `_audit_findings`, pins) in `SYSTEM_DENY_LIST` (`api/src/services/graphql/schema/index.ts`). They are written through raw knex and never purged, so a cached `/graphql/system` read went stale. Test: `schema/get-types.test.ts` (system scope, only `directus_users` gets a type); red on test-only commit `bcc6f385fd`.

Autoreview decisions (jean: "1 => A. 2 => B"):
- **1 → A:** `directus_scoped_cache_pending_purges` is raw-written, has a PK, but is NOT in `collections.yaml` / `SYSTEM_COLLECTION_NAMES`. `isSystemCollection` needs the name listed (not just the `directus_` prefix) and `get-schema` loads every PK table, so `/items` and `/graphql` (items scope) served it cached, and an admin could write rows the drain runs. Fix: register it as a system collection + add to the deny list.
- **2 → B:** fix inside #643 the raw writes that skip the purge: `authentication.ts` (`status: 'suspended'`), `shares.ts` (`times_used`), `users.ts` deleteMany (FK nulling on comments/notifications/versions). Reuse the `touchLastAccess` purge mechanism.
- `flows.ts:40` raw operations update: unverified, not in the PR.

Landed in `aa9b6e2cf5` + `e23c49b2ef`: helper `api/src/utils/purge-raw-write.ts` (`purgeRawWrite(knex, schema, collection, rows)`): defers via `queueAfterCommit` in a trx, else purges at once; a failed immediate purge is logged (`logger.error`), not thrown (the raw write already landed). Suspension + user delete purge in both cache modes; the shares `times_used` counter only in scoped mode (mirrors `touchLastAccess`). Test: `purge-raw-write.test.ts` (red on `a1bef48bd7`).

RULED on the 2nd autoreview (jean):
- **#1 → C.** `users.deleteMany` selected every referencing id and purged by the post-write row, so the OLD scope slice stayed stale. Route the FK nulling / suspension / share counter through a plain `ItemsService` (no accountability, `emitEvents: false`; NOT `UsersService`, which clears sessions and refuses to suspend the last admin). `updateGroups` snapshots rows before AND after the write and purges the old slice too, so `purgeRawWrite` goes away. Share login passes `autoPurgeCache: scopedCachePurgeEnabled()` (precedent `controllers/users.ts:186`). `deleteMany` chunks ids at the call site (10 000): `updateByQuery` → `getKeysByQuery` (limit -1) → `updateMany` → one `whereIn`. Core chunking investigated: the knex fork rewrites `whereIn` > 65535 to `= any($1)` on PG, so the bind limit is not a real risk there.
- **#5 → B.** A hand-made collections row is a dev mistake; reply on the thread, no migration.
- **#6 → fix all** test gaps (rewritten with C, tests first, red in CI).
- **#7 → deprecate full purge mode** as a boot warning naming `CACHE_AUTO_PURGE_MODE` plus a comment, IN this PR, linked issue #644 (test in cache.test.ts). Full mode is removed once the scoped cache is complete.

MERGED 2026-10-28 as merge commit `ddcc750441` into `v11.10.1-hhh-dev` (jean asked; merge commit, not squash, fork convention), closing #642 + #645. #645 (post-commit survivor snapshot failure → 500 + no purge) was fixed in-PR: `deleteMany` `.snapshot(selfRelationSurvivorKeys).catch(() => null)` like `updateMany`; red `b081289d5f`, fix `9e76870129`. `purgeOrRecord` (purge.ts:986) catches a failed post-commit purge (read, untested). Follow-ups: #644 (drop full mode), #646 Redis cluster, #647 comments (user-delete loop → `ON DELETE SET NULL`), #610 point 9, knex#10 (`arrayParameterThreshold`, awaits go). `codecov/patch` can read red BEFORE unit/bb uploads land (88% then green): wait for all checks.

Settled (do not re-raise): no fields yaml for the new collection (siblings have none); name-list order test fine (appended last in both); purge-before-write ordering is covered by `queueAfterCommit` for trx.

Known bounds (documented in the PR body, settled): an m2a listing a denied table in `one_allowed_collections` throws at schema build (`read.ts:829`, already true for `directus_sessions`); an Insights panel on `directus_cache_stats_descriptors` now errors; an m2o into a denied table drops that field.

**Why:** a new raw-written table is not covered by the deny list unless it is also a registered system collection; no test pins yaml ↔ deny list (only yaml ↔ constants).
**How to apply:** adding a raw-written table → register in collections.yaml + SYSTEM_COLLECTION_NAMES + SYSTEM_DENY_LIST. Do not merge #643 without a new explicit ask. See [[project_directus_raw_trx_purge_pr641]].
