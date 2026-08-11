---
name: project_directus_oas_publishing
description: "Publishing a path in the Directus OpenAPI: visibility is gated per TAG (x-authentication), /server/specs/oas needs no credential, env-gated routes still appear, and the spec is OAS 3.0.1 (nullable, not type null)"
metadata:
  type: project
---

**`GET /server/specs/oas` requires no credential**, and `SpecificationService`
decides what a caller sees **per tag**, never per path
(`api/src/services/specifications.ts:136`):

```ts
if (systemTag['x-authentication'] === 'admin' && !this.accountability?.admin) continue;
if (systemTag['x-authentication'] === 'user'  && !this.accountability?.user)  continue;
// Remaining system tags that don't have an associated collection are publicly available
```

So **a tag with no `x-authentication` is served to anonymous callers**, and every
path carrying it goes with it. `Utilities` is `user`, i.e. visible to any
authenticated non-admin. An admin-only surface therefore needs its own tag with
`x-authentication: admin` (`Schema` is the upstream precedent) — adding one path
to an existing tag inherits that tag's audience.

**Env-gated routes still appear in the spec.** The OAS is assembled from static
YAML while the router is conditional (`if (processesReportEnabled())`,
`if (systemMcpEnabled())`), so the path is published even where it 404s. Say so
in the `description` and document a `'404'` response — there is no mechanism to
drop it, and `/metrics` sets no precedent (it is not in the spec at all).

**The spec is `openapi: 3.0.1`** — `type: 'null'` is JSON Schema and fails
`pnpm --filter @directus/specs validate`; use `nullable: true` beside the
`oneOf`. That validate run also reports pre-existing `/items` errors, so grep for
your own path rather than reading the exit code.

**How to apply:** new admin-only endpoint → new tag + `x-authentication: admin` +
register the path; then assert the negative in blackbox from *two* credentials
(anonymous and `USER.APP_ACCESS`) with a public path still present, so the test
cannot pass on an empty spec. Runtime access is separate and already enforced by
`UtilsService.assertAdmin` — this is disclosure only.
