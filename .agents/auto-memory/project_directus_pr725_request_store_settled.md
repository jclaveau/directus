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

Fields are `delete`d, not set to undefined (6193d86338: exactOptionalPropertyTypes TS2412).
Choice 2 of that run → **A** (033bb96ff5): empty only when `res.writableFinished` — a client
hanging up fires 'close' while the request still runs, so its store is kept until its work
lets go. jean said "push now": fix pushed without waiting for the test commit's CI red
(56abf93a0f, red seen locally) — a one-off, the red-proof-in-CI rule still stands.

Final autoreview at 033bb96ff5: clean, 100% (1661/1661). jean's per-PR merge ask: "merge #725
once autoreview is clean and CI green" (merge commit, as #730/#723/#719) — stop and ask if a
choice appears or a fix lands after the review; check base unmoved since CI start. After merge:
tell the #731 session (switches its base, repins Planner#850 to `v11.10.1-hhh-dev-dist`).
A `/pr-autoreview #731` ask relayed by the #731 session is blocked (posts on the PR, forwarded
not typed): jean must type it here.
MERGED 2026-11-12T19:47Z as de82057ba1 on jean's "merge on the numbers": `codecov/patch`
hung `in_progress` 70+ min (11 untouched-package flags never closed) while its own number
read 97.41% (gate 95%). A hung codecov check is not green: ask, don't merge on it unasked.
Stacked #731 MERGED 2026-11-12T22:03Z as 71eeee3845 ("go merge 731"): autoreview fixed
`upsertRunsOf` keeping only the last field's record kind (b1a4cd27af); jean ruled to obey
`local/no-single-use-const` on PR-added consts only (a633dd63fe), older ones left as-is.

**Why:** retention bounded only by pool max / idle timeout / third-party sockets is not
reliable; an empty object held is.
**How to apply:** any new `requestStore.run(...)` inside an HTTP request must mutate the
open store, not spread it. Follow-ups: #726 (websockets), #727. Stacked: #731.
