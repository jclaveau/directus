---
name: project_planner_lockfile_types_node_churn
description: Planner's pnpm-lock.yaml does not round-trip — an open-ended @types/node peer makes every re-resolution rewrite ~370 unrelated lines; a pnpm.overrides pin fixes it, measured
metadata:
  type: project
---

Any `pnpm update`/`pnpm install --no-frozen-lockfile` in `planner_2` rewrites **~370 lines
of unrelated graph**, so a one-line dependency bump cannot be committed from a plain update.
Diagnosed 2026-09-08 while bumping the fork pin for the #452 deploy.

**Root cause — an open-ended peer range, not the fork bump.** The workspace declares
`@types/node` only at `^18.16.18` (apps/directus, apps/quasar), `^20.10.4` (apps/domain) and
`^18.13.0` (packages/directus-extension-models). But `vite@8` declares the peer
`^20.19.0 || >=22.12.0`, `vitest@4` `^20.0.0 || ^22.0.0 || >=24.0.0`, `jest-config` `*` — all
unbounded above. With `autoInstallPeers: true` (lockfile `settings:`), pnpm fills those with
whatever is newest on npm, so a **fourth** version (26.5.0, matching none of the declared
ranges) enters the graph. Four versions coexist: 18.19.130, 20.19.31, 20.19.43, 26.5.0.

The churn is the peer suffix: pnpm embeds `(@types/node@X)` in dozens of dependency keys, so
whenever the winner flips the whole block rewrites. It flips **both ways** between runs
(26.5.0→18.19.130 on one install, 18.19.130→26.5.0 on the next) — deduping tie-break, not a
monotonic upgrade, which is why it looks like noise rather than drift.

**Verified fix** — one line in `package.json` `pnpm.overrides`:

```json
"@types/node": "^22.20.1",
```

Measured: 4 versions collapse to 1 (22.20.1), and the lockfile becomes **idempotent** — two
consecutive `pnpm install --no-frozen-lockfile` runs produce a byte-identical lock.

**Cost, measured (baseline-diff, not raw counts):**
- `apps/domain` `ts:check:front`: **0 errors** under the override. Green stays green.
- `apps/quasar` `ts:check`: **472 → 523**. That check is *already red* on the baseline and
  gates nothing; all ~51 additions are in `*.e2e.spec.ts` and are inference degradations
  (`unknown`, `never`, implicit `any`), not Node API incompatibilities.

`^22` is also the *correct* target — `package.json` `engines` requires `node >=22.12.0`, so
the declared `^18`/`^20` type packages are already older than the runtime.

**Second, smaller thread:** `@smithy/node-http-handler` also moves on re-resolution (4.12.1
alongside a 4.8.1). AWS SDK splits its ranges — `credential-provider-http` and
`nested-clients` want `^4.11.3` while `client-ses`/`client-s3` want `^4.7.6` — so pnpm can
split a previously deduped version. Not peer-driven, much smaller, unfixed.

**How to apply:** until the override lands, bump a fork pin by **substituting the SHA in
place** (`sed` old→new over `pnpm-lock.yaml`, then `pnpm install --frozen-lockfile` to prove
it), never by `pnpm update`. See [[project_planner_directus_dist_pin]].
