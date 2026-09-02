---
name: project_planner_directus_dist_pin
description: the planner pins @directus/* to a BRANCH specifier but pnpm-lock records a COMMIT and the prod Dockerfile installs --frozen-lockfile — so redeploying ships nothing new; the lockfile must be re-resolved and committed first
metadata:
  type: project
---

"Merge the fork fix, then redeploy" does **not** ship it. Verified 2026-08-20.

`the-HipHipHip/Planner` `apps/directus/package.json`:

```
"@directus/api": "github:jclaveau/directus#v11.10.1-hhh-dev-dist&path:api"
```

but `pnpm-lock.yaml` resolves it to a tarball at a fixed SHA:

```
version: https://codeload.github.com/jclaveau/directus/tar.gz/<40-hex>#path:api
```

and `apps/directus/cd/railway/Dockerfile.directus-bo.railway:79` runs
`pnpm install --frozen-lockfile --prefer-offline`. A Railway redeploy therefore
re-installs the SAME tarball. Both `develop` and `main` carried the stale pin.

**How to check, before promising a deploy fixes anything:**
- current dist tip: `git ls-remote https://github.com/jclaveau/directus refs/heads/v11.10.1-hhh-dev-dist`
- what a branch pins: `gh api "repos/the-HipHipHip/Planner/contents/pnpm-lock.yaml?ref=<branch>" -H "Accept: application/vnd.github.raw" | grep -o 'codeload.github.com/jclaveau/directus/tar.gz/[a-f0-9]\{40\}' | sort -u`
  (quote the URL — zsh globs the `?`; the contents API needs the raw Accept header for a >1MB file)
- what PROD built: same call with `?ref=<the deploy's commitHash>` from `railway deployment list`
- does a dist SHA carry a fix: `gh api "repos/jclaveau/directus/contents/<path>?ref=<sha>"` — presence of a file the fix added beats reading dates.

**The bump:** `pnpm install --filter ./apps/directus --lockfile-only`, confirm the
diff is only the SHA, commit, then deploy. `develop` is the integration branch
(deploys are `Merge pull request #NNN from the-HipHipHip/develop` into `main`).

Related: [[feedback_bump_not_patch_consumer_dep]], [[feedback_verify_moving_tag_payload]],
[[project_scalabus_derived_branches]], [[project_directus_cache_stats_prod_incident]].
