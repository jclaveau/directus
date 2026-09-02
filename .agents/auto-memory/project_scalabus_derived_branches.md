---
name: project_scalabus_derived_branches
description: jclaveau/directus derived branches — *-dist (release-fork.yml) and ci-dialect-* (refresh-dialect-ci.yml) are regenerated from the trunk on every push, so never rewrite or hand-edit them; -dist is what the planner installs
metadata:
  type: project
---

Two branch families are **generated, not authored**. Both rebuild from the trunk tip on
every push to `v11.10.1-hhh-dev`, via `checkout -B <branch> origin/<trunk>` — a full
replacement, never a merge or rebase.

- **`<trunk>-dist`** — `release-fork.yml`, on push to `*-hhh-dev`. Deletes the dist branch
  and recreates it as trunk + one bot commit "Add dist folders content". It runs
  `pnpm pack` per workspace package and extracts the packed `package.json` back, to
  de-catalog `catalog:`/`workspace:` specs so external `github:` consumers can resolve
  deps. **Don't hand-roll this** — the planner installs from it.
- **`ci-dialect-{sqlite3,maria}`** — `refresh-dialect-ci.yml`, on push to the trunk only.
  One deterministic no-op commit naming the dialect in `.github/ci-dialect`; the
  force-push fires `pull_request: synchronize` on standing PRs #332/#333, which is what
  actually runs those dialect matrices. Regenerated rather than rebased *on purpose*: a
  conflicting PR would set `mergeable=CONFLICTING`, which silently stops every
  `pull_request` workflow — checks wouldn't go red, they'd stop existing.

**How to apply:**
- **Never include them in a history rewrite or a push gate.** They carry a bot commit the
  trunk doesn't have, so a byte-identical gate fails them by construction — and they fix
  themselves on the next trunk push anyway. 2026-08-06 both dialect branches cleared their
  stale licence automatically that way.
- **Never delete `ci-dialect-*`** — that closes the standing PRs that run sqlite3/maria.
- The planner consumes the fork as a codeload tarball, `github:jclaveau/directus#<branch>&path:<pkg>`,
  which delivers **`api/src`, not just `dist`** — full TypeScript source lands in every
  consumer's `node_modules` on `pnpm install`.
- `planner` and `planner_2` are separate checkouts pinning *different* lines
  (`v11.9.2-hhh-dev-dist` vs `v11.10.1-hhh-dev-dist`). Check which is live before drawing
  conclusions from a lockfile — [[feedback_review_actual_pr_branch_not_preview_tree]].

Related: [[project_scalabus_licensing]], [[reference_gha_branch_rename_closes_pr]].
