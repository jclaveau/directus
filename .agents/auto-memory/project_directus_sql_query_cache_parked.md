---
name: project_directus_sql_query_cache_parked
description: PARKED — SQL/row-level query cache (layer below readByQuery response cache) + per-owner partition tagging + owner-tagging for sharing; decided not now
metadata:
  author: Jean Claveau
  type: project
---

PARKED 2026-06-26 at jean's request. Context: scoped (tag-based) response-cache invalidation
shipped in PR #203 (`v11.10.1-feat/scoped-cache-invalidation` → `v11.10.1-hhh-dev`,
`CACHE_AUTO_PURGE_MODE=scoped` now default). A consumer's hot collections: two per-user
collections and a 13.9M-row `slots` collection (details in the consumer repo's
memories). Data per-user now; `slots` written frequently (adding slots), localized
to one owner today; sharing data with other users is a likely future.

## Idea considered: cache raw SQL results inside runAst (layer below the response cache)
- Response cache (current) keys by `{user,path,query}`, stores assembled JSON; on hit short-circuits
  everything → SQL cache adds nothing on that path.
- SQL cache's only real edge = **cross-user sharing**: permissions are baked into the SQL by
  processAst, so users with identical effective policies → identical SQL → shareable rows the
  per-user response key can't share.
- Verdict: **not worth it now** (data is per-user → no cross-user benefit; second leakier layer,
  harder invalidation, transaction read-your-writes traps). Response cache + scoped invalidation
  captures the bulk at far lower risk.

## The limits that DO bite this workload (the real follow-ups, also parked)
1. **Scoped tag is collection-level**, not per-row. Frequent `slots` writes purge
   `tag:slots` wholesale → every owner's slot cache dies on any one owner's write.
   Cross-collection isolation works (slot writes spare the other two collections); intra-collection
   per-owner isolation does NOT.
2. **Fix = per-owner partition tagging**: tag `slots:owner=<id>`. Read filtered to
   A → tag `owner=A`; A's create (payload carries `owner` → easy hot path) purges only
   `owner=A`. Updates/deletes without a clear owner → fall back to collection-wide purge (coarse,
   always safe — never under-purge).
3. **Sharing handled by OWNER-tagging, not reader-tagging**: tag by whose data was read (owner of
   the result rows), not who read it. Invalidating `owner=A` then hits every reader who cached A's
   data — no need to enumerate the share-set. Multi-owner lists ("shared with me") → tag from the
   distinct owner values in the RESULT rows, not the filter. Exception: share grant/revoke is an ACL
   mutation (data unchanged, visibility changed) → needs separate reader-dimension invalidation;
   rare → handle coarsely.
4. **Per-collection `user-scoped | shared` flag** feeding both the cache-key builder and tag
   granularity, so the future shared switch = config flip (drop `user` from key + widen tag), not a
   rewrite.

## Prerequisite that outranks all caching work
**DB structural fix first** for `slots` (composite PK / partition by owner — see the
consumer repo's memories). Frequent writes ⇒ cache often cold ⇒ cold-read speed
dominates; caching can't rescue a slow cold path under heavy writes. Measure the query cost before
investing more in cache sophistication.

All of the above rides the existing `SADD`/`SMEMBERS`/`purgeCache` infra — just richer tag values
and an owner-extraction step (read: from result rows; write: from mutated rows). Unpark when sharing
ships or the slot cache churn is measured as a real bottleneck.
