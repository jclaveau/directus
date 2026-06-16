---
name: directus-compose-copy-stack
description:
  How hhh-main is composed conflict-free — isolated upstream-draft PRs stay clean for upstream; a parallel
  hhh-main-root/stacked copy tree resolves overlaps once; compose consumes the copies. SSH deploy key + CLA inject.
metadata:
  type: project
---

The open `upstream-draft:` PRs collide when composed (several edit `api/src/services/items.ts`/`items.test.ts`).
Resolution (2026-06-16, jclaveau/directus): keep upstream-draft PRs **isolated off `main`** for upstream submission, and
maintain a parallel **copy tree** that compose consumes.

## The copy tree

- **`hhh-main-root:` <title>** — isolated PR (no file overlap with any other), base `main`, unchanged content.
- **`hhh-main-stacked:` <title>** — rebased onto its **parent copy** (not the upstream-draft branch → decoupled from
  upstream churn). Every member of a conflict-connected component is stacked; only truly-isolated PRs are roots.
- Built by **cherry-picking each PR's own commit range** onto the advancing tip (NOT merging heads — a stacked
  upstream-draft head contains its parent, which would double-apply). Order = the mergeability rubric
  [[directus-compose-stack-order-rubric]].
- Always open. Each PR description records: copy-of #, parent, exact resolution, and a **re-rebase recipe** so a refresh
  after a `main` sync is mechanical.

## Compose consumes the copies

`compose-hhh-main.yml` discovers `hhh-main-root:`/`hhh-main-stacked:` titles (not `upstream-draft:`), topo-merges them
(clean by construction), CLA-signs, builds, api-tests, force-pushes hhh-main. A merge conflict now means the **stack is
stale vs main → re-rebase** (not raw inter-PR conflict). Verified green end-to-end.

## Two infra mechanics that are load-bearing

- **SSH deploy key, not GITHUB_TOKEN, for pushes** — App tokens are forbidden from pushing `.github/workflows/*` changes
  (both the main sync and the hhh-main force-push carry them). Deploy key `compose-bot` (write) + secret
  `COMPOSE_SSH_KEY`; checkout `with: ssh-key: ${{ secrets.COMPOSE_SSH_KEY }}`. Repo-scoped, non-expiring.
- **CLA auto-sign** — compose's merge commits are authored by `hhh-bot`; directus/cla-bot reads `contributors.yml` from
  the **head ref** (hhh-main), so compose appends `- hhh-bot` to contributors.yml on hhh-main before commit (kept off
  `main`).

Excluded from the stack: **#46** (refused upstream → `superseded`), **#52** (divergent history — see
[[directus-stacked-rebuild-gotchas]]). #67 = the upstream-compare view of hhh-main.
