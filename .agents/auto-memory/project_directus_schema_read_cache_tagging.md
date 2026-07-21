---
name: project_directus_schema_read_cache_tagging
description: PR #222 — schema-describing read endpoints (/fields,/relations,/schema/snapshot,/collections) tagged by their SYSTEM collection so business writes leave them cached; root bug was validateCollection overwriting req.collection; orphan-guard for tagless collection-less GETs in scoped mode
metadata:
  type: project
---

PR **#222** (MERGED into v11.10.1-hhh-dev) — "stop untagged cached responses orphaning in scoped-purge mode".

**Orphan guard (respond.ts).** In scoped mode, purge is tag-targeted (Redis sets: tag → keys). A response cached with
`scopedCacheTags = []` is indexed under no set → no mutation can ever purge it → serves stale until TTL (this caused
the license-banner re-ask on `/server/info`). Guard: `orphansInScopedMode = scopedCacheTags.length === 0 &&
scopedCachePurgeEnabled()` → skip caching. Full mode still caches it (`cache.clear()` wipes everything on any write, so
it can't orphan). The `/server/info` should-not-cache-at-all point was raised but jean said "don't care" — left cached
via the mode-guard; its sibling `/server/health` already sets `res.locals['cache'] = false`.

**Schema reads tagged by their SYSTEM collection.** `/fields`,`/relations`,`/schema/snapshot`,`/collections` describe
SCHEMA, not data — a business-row INSERT must NOT flush them. Tag by `directus_fields`/`directus_relations`/
`directus_collections` so only a schema mutation (which `cache.clear()`s fully anyway) invalidates them.

**Root bug found via a blackbox HIT-after-write assertion**: `/fields/:collection` was flushed by a business write.
`validateCollection` (collection-exists.js:17) runs AFTER `useCollection('directus_fields')` on the `/:collection`
routes and **overwrites `req.collection` with the URL param** (the data collection) → the respond.ts fallback tagged the
DATA collection → a data write purged it. Fix: set the tag EXPLICITLY, not via the `req.collection` fallback.

**Final shape — service emits, controller forwards (uniform with `items.ts:117`).** The tag lives in the SERVICE via
`withMeta(result, { scopedCacheTags: [{ collection: 'directus_fields' }] })` (`FieldsService.readAll/readOne`,
`RelationsService.readAll/readOne`, `SchemaService.snapshot` = 3 system collections). Controllers just forward
`res.locals['scopedCacheTags'] = readMeta(result)?.scopedCacheTags`. This is the ONLY correct pattern — every other read
controller already forwards `readMeta`; hardcoding a literal in the controller was the smell jean flagged.

**Coarse-tag rationale + parked follow-up.** System collections have `scoped_cache_fields = null` (system-data never
sets it), so the tag is the coarse `{collection}`. Field mutations `cache.clear()` FULL (`fields.ts:465`), not scoped —
so finer scoping buys nothing TODAY. But `directus_fields` rows carry a `collection` column and the reads already filter
`{collection:_eq}`, so `scoped_cache_fields=['collection']` COULD later derive a per-collection tag (option B). Kept the
coarse literal (option A) + a sameline `// TODO scope by the related collection's scoped_cache_fields` on each service
return. Option B was rejected for now: no payoff while writes full-clear; would foreclose nothing that A doesn't.

Related: [[project_directus_scoped_cache_tag_derivation]], [[project_directus_scoped_cache_design]],
[[reference_directus_emitfilter_same_ref]].
