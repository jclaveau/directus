---
name: project_scalabus_publish_plan
description:
  PARKED plan — publish the directus fork as @scalabus/* to GitHub Packages npm to speed up the hiphiphip planner
  install; locked decisions on registry, rename mechanism, versioning, sequencing
metadata:
  type: project
---

PARKED 2026-06-24 ("park for now"). Full plan: `~/.claude/plans/keep-the-upstream-xxx-prs-drifting-volcano.md`.

**Why:** planner (`/home/jean/dev/Hippocast/dev/planner-caddy-ios`) depends on the fork via
`github:jclaveau/directus#<branch>&path:<subdir>`. pnpm's `&path:` downloads the **whole ~5800-file monorepo
tarball from codeload once per resolved peer-combo (273 lockfile entries)** → slow install. `-dist` branch already
commits build artifacts, so it's NOT compile-on-install — purely the repeated full-repo fetch. `.pnpmfile.cjs:6`
already has the TODO ("pnpm pack + commit tgz").

**Locked decisions:**
- **Registry** = GitHub Packages npm (`npm.pkg.github.com`), scope `@scalabus`, new `scalabus` GitHub account.
  GH Packages **forces scope = owner** (so the rename is mandatory) AND **requires an auth token even to install**
  (consumers add `.npmrc` + `_authToken` secret). User confirmed "directus packages" on GH Packages, NOT ghcr
  container images (ghcr = containers only; that route is out-of-scope though the fork's `release.yml` already pushes
  GHCR images).
- **Rename** = **publish-time only**: source stays `@directus/*`; pipeline rewrites `@directus/`→`@scalabus/` in built
  `dist` + generated `package.json`. Safe invariant: rewrite ONLY the `@directus/` scope prefix — NEVER the frozen
  runtime IDs (`directus_*` tables 291 files, `DIRECTUS_*` env, `'directus:extension'` manifest key,
  `directus-extension-*` convention, registry/telemetry URLs, Docker `/directus` paths) — none contain `@directus/`.
  Blanket dist replace also fixes the 3 compiled-in scope literals (APP_SHARED_DEPS etc.) for free.
- **Versioning** = fork's **own independent semver**, clean `X.Y.Z` (e.g. `@scalabus/api@1.0.0`), **NO upstream
  version in the string** (so `^`/`~` ranges work). Upstream base tracked in a per-package `package.json` `"upstream"`
  field, auto-stamped on sync. **Shared** version across all packages (changesets `fixed` group) → one scalabus
  version + tag `scalabus-vX.Y.Z`. (User iterated: rejected `29.1.0-scalabus.N` prerelease and `29.1.0-1.1.1`
  hybrid → wants pure own semver.)
- **Sequencing** = quick `.tgz` win FIRST (pnpm pack the needed set: `directus`, `@directus/{api,errors,sdk,
  extensions-sdk}` + transitive `@directus/*`; consume as `file:` tgz → kills codeload), THEN the GH-Packages pipeline.
- **Planner consumption**: keep its `@directus/*` imports unchanged via aliases
  `"@directus/sdk": "npm:@scalabus/sdk@^1.0.0"`; no planner source edits.

Final goal: faster planner install. Related: [[project_directus_fork_integration_branches]].
