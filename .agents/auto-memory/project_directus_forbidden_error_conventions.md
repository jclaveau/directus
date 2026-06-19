---
name: project_directus_forbidden_error_conventions
description:
  Directus error conventions — 403 for missing items (anti-enumeration), pre-access input validation should be 400,
  ForbiddenError({reason}) is upstream, status never env-gated
metadata:
  type: project
---

How Directus models permission/not-found errors (verified on `origin/main`):

- **403 for a missing item, by design.** `ItemsService.readOne` (`api/src/services/items.ts`, the `results.length === 0`
  guard) throws `ForbiddenError` whether the row is **absent** or **permission-filtered out** — indistinguishable. There
  is **no `NotFoundError`/404 in the items path** (anti-enumeration). So a missing item = 403, not 404.
- **`ForbiddenError({ reason })` is upstream** — `packages/errors/src/errors/forbidden.ts` `messageConstructor` surfaces
  `reason` as the message, **always-visible in every env** (no env-gating). The permissions engine
  (`permissions/modules/validate-access/`, `process-ast/.../create-error.ts`) already builds reasoned errors
  (collection/field/action/path + "or it does not exist" hedge).
- **`error-handler.ts`** takes status from the error **type** and adds dev-only detail (`extensions.stack` only when
  `getNodeEnv()==='development'`). Status is **never** env-conditional — see [[feedback_api_status_code_is_contract]].
- **Pre-access input validation → 400, not 403.** `validateKeys` runs before any lookup, so a malformed PK is a bad
  request (`InvalidPayloadError`), not an authorization failure — no existence to protect. Done in PR #62.

**This session's PRs:** #61 = the fork's full `ForbiddenError` reason sweep (~54 reasons / 16 files, his exact wording +
`// 404 ?` / `// InvalidPayload ?` TODOs); #62 = validate-keys `403→400`. #61 carries a comment inventorying 47
still-bare `ForbiddenError()` sites. Extraction policy: [[feedback_extract_keep_all_but_upstream_equiv]].
