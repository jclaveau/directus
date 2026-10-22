---
name: project_directus_pr448_details_narrowing_bug
description: PR #448 processes `details` narrowing param — the false-unavailable bug it reintroduced and the general lesson
metadata:
  author: Jean Claveau
  type: project
---

MERGED (`5142200da4` on hhh-dev). Threaded a caller-narrowable `details` (`stats`/`env`)
through `collectProcesses`/`readProcesses`/`GET /utils/processes?details=`/MCP
`list_processes`, mirroring the existing `readPgBouncer(details)` precedent. Narrowing is
safe by construction — the responder-side intersection with `PROCESSES_REPORT_DETAILS`
is unconditional, so a request can only ever ask for a subset of what the deployment
already exposes, never widen it.

**The bug a deep review caught, not authorship:** `reportSelf` gated `supervisor` (the
`pm2 list`, see [[project_directus_pr447_pm2_supervisor_cpu]]) and `capacity` on
`carries('stats')` in the *request's* details list, not the deployment's. So
`list_processes { details: ["env"] }` — exactly the call the tool's own description
invites ("worth reading only when comparing configuration") — made every node send
`supervisor: null`. The collector read that as `supervisor: 'unavailable'`, set
`degraded.supervisor: true` on a perfectly healthy PM2 deployment, and rebuilt the
process tree from self-reports alone — silently dropping any worker crash-looping too
fast to answer the bus. A caller asking for *less* would have manufactured the exact
false-unavailable outage #447 had just fixed, reachable again through a request
parameter. **General lesson:** when a report has a narrowable "detail" axis, anything the
collector needs for its own bookkeeping/enumeration/liveness (here: the supervisor
spine) must stay tied to the *deployment's* configured set, never to the *caller's*
narrower request — only the optional payload (here: `runtime`/`env`) should follow the
request. Fix: `pm2 list` now follows `PROCESSES_REPORT_DETAILS` alone.

**Two smaller settled fixes, same review pass:** the MCP `details` enum was hardcoded
`['stats','env']` even on a `PROCESSES_REPORT_DETAILS=stats`-only deployment, so calling
with the advertised-but-unsupported `env` value silently returned *less* than calling
with no argument at all (unknown tokens read as "no preference", not "empty set") — enum
now built from `reportedProcessDetails()`, the same source as the tool description. The
blackbox witness picked its replica by array index across two *independent* 3s
collection windows — order- and completeness-dependent, would flake if one replica
missed a window — now selects by `replicaId` with an explicit `toBeDefined()`.

**Also fixed:** `/utils/processes`'s new query param wasn't documented in the published
OpenAPI spec (`packages/specs/src/paths/utils/processes.yaml` had no `parameters:`
block, modeled now on `cache-entries.yaml`'s `window`) — self-caught before the review
agent flagged it independently. Confirmed clean: `res.locals['cache'] = false` on this
route means the new param can't poison a cache key (a query param not in
`sanitizeQuery`'s known set would otherwise collapse distinct requests into one cache
entry).

**Why:** the 98KB `PROCESSES_REPORT_DETAILS=stats,env` response (full env dump on every
process) made `list_processes` too expensive to call routinely; narrowing per-call is
strictly better than narrowing the deployment's config for everyone.

**How to apply:** the same false-unavailable risk applies to `readPgBouncer(details)` —
it hasn't been audited for the same class of bug and has no OpenAPI spec entry at all
(pre-existing, out of scope, not yet raised as its own issue).
