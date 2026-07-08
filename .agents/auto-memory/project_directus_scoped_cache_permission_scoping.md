---
name: project_directus_scoped_cache_permission_scoping
description: Scoped-cache follow-ups — #205 write-side post-hook fix (landed) + permission-aware read scoping (branch A)
metadata:
  type: project
---

Two follow-ups on top of [[project_directus_scoped_cache_design]] (#205 value layer), both PUSHED. #205 head later moved through style commits (comment/docblock wrapping + the `lint:style:changes` gate) to `80c84cfab5`; #206 (permission scoping, draft) PARKED — no further pushes. The original commits below are the substance:

- **Option 1 — write-side post-hook fix** (`work-pr205`, commit `2c44b4381a`):
  - Purge tags were derived from raw input `data`; a `items.create`/`update` filter hook can rewrite a scope field, so the pre-hook value tags the wrong slice → stale HIT.
  - Fixed: createMany tags from inserted `actionHookPayload`s (a hook *takeover* — returns a PK, inserts itself — forces a full flush); updateMany uses `payloadAfterHooks`; updateBatch re-snapshots committed rows.
  - Detect takeover via `results.filter(k=>k!==null).length > actionPayloads.length`.

- **A — permission-aware read scoping** (branch `v11.10.1-feat/scoped-cache-permission-scoping`, commit `644868221e`, stacked on option 1):
  - **The gap:** `pinnedScopeTagsFromFilter` reads the API filter, which is BEFORE permission filters merge into the AST. So a permission-isolated read (planner `student=$CURRENT_USER`, no explicit filter) → empty API filter → bare collection tag → every student's write purges every student's read. The sledgehammer #205 meant to kill still lands on the planner.
  - **Fix:** also scope off `ast.cases` (permission rules injected by `injectCases` in `processAst`). New `pinnedScopeTagsFromCases`; `pinnedScopeTagsFromFilter` gained an optional value-resolver so both share one walk.
  - **Soundness basis:** `joinFilterWithCases(filter, cases)` applies cases as a row WHERE `{_or: cases}`. A SINGLE case excludes non-matching rows → bounds the read exactly like `_eq`; multiple cases are OR'd → don't bound. So pin ONLY `cases.length === 1`. Verified, not assumed.
  - Dynamic vars resolved to MATCH `parseDynamicVariable` (`@directus/utils` parse-filter): `$CURRENT_USER`→`accountability.user`, `$CURRENT_ROLE`→`role`; richer forms ($CURRENT_USER.field, $CURRENT_ROLES/$CURRENT_POLICIES arrays, $NOW) bail to bare (safe).
  - **Still to do before A merges:** e2e/blackbox with real permissions (only unit-tested so far); richer dynamic-var resolution via the fetched variable context.

Architecture facts established this session:
- Read order (`items.ts` readByQuery): `getAstFromQuery` (bare AST, no perms) → `processAst` (runs the n-join `fetchPolicies`/`fetchPermissions`, then `injectCases`) → `runAst`. Resolved/effective AST is the OUTPUT of the n-join step.
- Permission n-joins are themselves cached: `fetchPolicies`/`fetchRawPermissions`/`fetchRolesTree`/`fetchGlobalAccess` are `withCache(...)` keyed by `{roles,user,ip}` → the `_system` Keyv namespace.
- **An AST-keyed cache layer is a dead end** for the planner: it must run `processAst` (perms) to compute its key, forfeiting the response cache's pre-permission short-circuit. Response-cache layer is correctly placed; permission-aware *scoping* (A) is the robust move, not a new layer.
- Permission changes DO purge the response cache: `policies/roles/access/permissions` services' `clearCaches` call `clearSystemCache(...)` AND `this.cache.clear()` (gated `autoPurgeCache !== false`). So A is safe across permission changes. The `schemaChanged` bus handler only auto-purges the data cache for `CACHE_STORE === 'memory'` (multi-node memory propagation); redis is shared so the originating node's `cache.clear()` suffices.
