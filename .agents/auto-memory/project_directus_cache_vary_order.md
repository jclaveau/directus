---
name: project_directus_cache_vary_order
description: PR #289 — CACHE_VARY_CONTENT_TYPES list order is SIGNIFICANT (not sorted); it must mirror the endpoint's own req.accepts() priority. Settled, don't re-raise "why not sort".
metadata:
  type: project
---

PR **#289** (request content-negotiation cache dimensions, `api/src/utils/get-cache-key.ts`).

`varyList()` normalizes each `CACHE_VARY_*` env list: `Array.isArray` guard (no `as`
cast — the value is typed `unknown`), `String().trim()`, drop blanks, `Set`-dedupe.
**Order is deliberately PRESERVED, NOT sorted.**

**Why not sort (settled — jean said "keep as is"):**
- The cache key folds `req.accepts(list)`. To bucket correctly it must return the SAME
  value the ENDPOINT's own `req.accepts(sameList)` returns.
- `req.accepts` is order-sensitive for `*/*` (and header-absent) callers — they get the
  FIRST listed type. Verified: `[json,csv,yaml]` → `*/*` → `json`; sorted `[csv,json,yaml]`
  → `*/*` → `csv`.
- Sorting desyncs cache-negotiation from endpoint-negotiation → a `*/*` caller (gets the
  endpoint's json body) and an explicit csv caller (csv body) collide in one `csv` bucket
  = poison. So `csv,json` ≠ `json,csv` is CORRECT — they model endpoints with different
  `*/*` defaults.
- Headers need no sort either: `resolveVaryHeaders` builds an object, and object-hash +
  the readable `sortNestedKeys` path both sort keys, so header-pattern order can't affect
  the key.

Order-independence + forget-proof is the response-`Vary` registry follow-up (**#290**) —
key on the response's actual `Content-Type`, so request-list order stops mattering.

Related: [[project_directus_env_type_map]], [[feedback_ts_as_cast_smell]],
[[reference_codeql_redos_public_util]].
