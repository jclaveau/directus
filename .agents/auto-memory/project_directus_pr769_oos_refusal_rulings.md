---
name: project_directus_pr769_oos_refusal_rulings
description: PR #769 settled rulings (2026-11-26) — out-of-scope features are refused unless OUT_OF_SCOPE_FEATURES_ALLOWED names them, one PR, tags stay, mssql/oracle dropped in it, flows switch next after a DB audit, files will not stay out of scope
metadata:
  author: Jean Claveau
  type: project
---

Settled by jean, do not reopen:

- Out-of-scope code is refused, not just tagged: at boot for env-switched features,
  route unmounted + service constructor refusal for shares/comments. Rejected: a
  `throw` inside the tagged branch (fails mid-request, adds unrun code).
- #771 (the refusal) was folded into #769 on jean's ask ("merge as one pr plz").
- Both layers stay: `// bb-out-of-scope` tags (CI only) and
  `utils/out-of-scope-features.ts` (runtime). The audit fails when they drift.
- Order: shares and comments (done), then flows after a DB audit of active flows and
  migrated webhooks (blocked: `hhh-prod-system` MCP answered 401). "Files won't be
  oos anymore soon so we'll discuss it later" — build no files switch.
- Tests: refused side for every feature; allowed side only where CI already has what
  it needs (LDAP server, SAML IdP skipped).
- "drop mssql and orcale in the current pr": pushed to #769 (`151f8a1780`). MariaDB
  uses the `mysql` helpers, which stay.
- Boot refuses only `mssql` / `oracledb` / `oracle`, not "anything off a list": a list
  would refuse knex aliases (`postgres`, `mysql2`). Migrations stay unedited
  (`isOneOfClients` type widened to accept `'oracle'`). `tedious` stays in the lockfile
  as the fork knex's optional peer.
- Leftovers first reported "left on purpose" went into #769 too: "drop the dead
  mssql/oracle bb setup too plz and the dead capabilities.insertReturningOptions() in
  bg". Pushed (`2e0626737c`, `5cb0fb4af1`), Check + blackbox + audit green there.
- codecov/patch: "go A", strip oos-tagged ranges before upload
  ([[project_directus_codecov_aggregate_patch_gate]]).
- Autoreview: two full runs (`4599b7b0fb`, `210ac68fda`) + one on the rename lines
  (`2a0f103fac`) → 100.0% on 2026-11-27. Map renamed `OUT_OF_SCOPE_FEATURE_ISSUES`
  (jean "go", each value is an issue; the env var `OUT_OF_SCOPE_FEATURES_ALLOWED` keeps
  its name).
- CodeQL `js/missing-rate-limiting` #70 (`assets.ts:29`) and #71 (`shares.ts:29`):
  upstream handlers, flagged only because a tag was appended. Dismissed "won't fix" on
  jean's call 2026-11-27, route limiters tracked as #657 point 2 and #709 point 14.
  The global limiter (`RATE_LIMITER_*`, off by default) is invisible to CodeQL.

**How to apply:** reviewing or extending #769, or adding a feature switch. Flows: make
`FlowManager.initialize` a no-op (a service refusal there makes boot throw), keep
`JobQueue` (extension manager uses it). Never make `getStorage()` refuse (health 503).
Related: [[project_directus_bb_branch_audit]],
[[feedback_directus_keep_bb_tags_in_source]].
