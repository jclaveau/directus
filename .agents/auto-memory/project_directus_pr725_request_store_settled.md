---
name: project_directus_pr725_request_store_settled
description: PR #725 (nested purges in the purged-tags header, one AsyncLocalStorage requestStore) — jean's rulings on its autoreview choices; do not re-raise
metadata:
  type: project
---

PR jclaveau/directus#725 (`v11.10.1-fix/nested-purged-tags-header`): one `requestStore`
holds the query audit and the purged list; opened per HTTP request, ws message, schedule
tick, flow run.

Rulings (do not re-raise): "go C with bb tests", "Async reader waits", store "opened on
request not before app.before … dropped on request end", "1 => go A so it makes the store
available everywhere hence consistent", "1 => isObjectWithOnlyId, 12 => B".

2026-11-12, choice 1 of the 6fff4b5075 run — a socket opened inside a request (new pool
connection, keep-alive agent) retains its ALS store while open. jean asked "no memory
leak risk with B?" then "what is the cleaner / more reliable solution?" → **A** (a300ed6da3):
`openRequestStore` sets `scopedCachePurged`/`queryAudit` to undefined on `res` 'close';
`auditRequestQueries` writes into the open store via `joinRequestStore`, never a
`{...getStore()}` copy (a copy escapes the clear). After close: recorders no-op, the reader
throws "outside a request" — header already sent, nothing lost.

**Why:** retention bounded only by pool max / idle timeout / third-party sockets is not
reliable; an empty object held is.
**How to apply:** any new `requestStore.run(...)` inside an HTTP request must mutate the
open store, not spread it. Follow-ups: #726 (websockets), #727. Stacked: #731.
