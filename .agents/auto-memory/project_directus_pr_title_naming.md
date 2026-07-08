---
name: directus-pr-title-naming
description:
  jclaveau/directus PR TITLE prefix is FUNCTIONAL — `v11.10.1-feat: ` is the exact grep the
  compose workflow uses to select features into the integration branch; classify by
  composed-vs-merged destiny, never by which files the PR touches
metadata:
  type: project
---

## ⚠️ LANDING MODEL CHANGED (2026-06-26) — direct-merge, not compose-and-close

The v11.10.1 stack is now a **single linear chain**, so `v11.10.1-hhh-dev` is maintained by
**`gh pr merge`-ing the leaf/feat PR directly into it** (merge commit, `--merge`/`--no-ff`). The
daily compose **cron is DISABLED** — `compose-hhh-v11.yml` is now **dispatch-only** and still
**force-pushes** `hhh-dev` (line ~224), so manually dispatching it would **clobber any direct
PR-merges**. So: to land a `v11.10.1-feat: …` PR based on `hhh-dev`, just merge it (`gh pr merge N
-R jclaveau/directus --merge`); do NOT dispatch compose unless re-anchoring on a new base tag.

This supersedes the old "feat PRs kept OPEN, composed, then closed (`merged=null`)" model below —
that's why historical feat PRs (#110, #192, …) show CLOSED + `merged=null`. New ones get merged
normally. Verify the current `on:` of `compose-hhh-v11.yml` before assuming either model.

## Title prefix is still a functional selector (compose fallback)

PR **title** prefix is a **functional selector**, not cosmetics. `compose-hhh-v11.yml`
(on `pr-controle`, now dispatch-only) builds the integration branch from the open feat PRs with:

```
prefix="$BASE-feat: "                         # e.g. "v11.10.1-feat: " (trailing colon+space)
gh pr list … | select(.title | startswith($p))
```

→ A composed feature whose title does NOT start with exactly `v11.10.1-feat: ` is **silently
excluded from composition**. The prefix is the API between the PR and the composer.

## Classifier = merge destiny (composed vs merged), NOT "touches CI files"

- **Composed feature** (kept OPEN, re-derived, lives in the integration tree, stacked on
  another feat or on prepare) → **MUST** be titled `v11.10.1-feat: <desc>`.
  - Runtime-stack features carry a 2-digit order: `v11.10.1-feat: NN — <desc>` (#98 `01 —
    drop index` … #110 `13 — batchInsert`). NN is human ordering only — compose orders by
    BASE (topo-merge), not by NN.
  - Build/infra features carry NO number: #115 build-tsdown, #114 extensions-rolldown, #190
    blackbox-coverage. Still the `v11.10.1-feat: ` prefix (mandatory for selection).
- **Merged into `v11.10.1-prepare`** (CI/codecov/deps/config — NOT composed) → conventional
  commit prefix, and these actually merge:
  - `ci(<scope>): …` — #186/#187/#189 `ci(codecov)/ci(blackbox)` (all MERGED to prepare).
  - `chore(deps): update dependency <x> to v<y>` — renovate, branch `renovate/*`.
  - `chore: …` — other.
- **compare:** / **V11.10.1-compare:** — diff vs upstream; base `upstream-v11.10.1`.
- **upstream-diff:** — fork-permanent, lands on trunk `pr-controle`, never upstream.
- **upstream-draft:** — upstream proposal, clean diff vs `main`.

## Branch name must match too (not just the title)

A composed feature's PUSHED branch is `v11.10.1-feat/<kebab-name>` based off
`origin/v11.10.1-hhh-dev` (e.g. `v11.10.1-feat/batch-insert` #192, `v11.10.1-feat/catalog-factorize`
#199). **Trap:** the LOCAL working branches use a different scheme — `fork-feat/<name>-v11` (e.g.
`fork-feat/batch-insert-v11`, what session-start `gitStatus` shows). NEVER push/PR under the
`fork-feat/*` name; create `v11.10.1-feat/<name>` before pushing. Renaming a branch that is already a
PR head closes the PR ([[reference_gha_branch_rename_closes_pr]]) → push the SHA to the new ref, open
a fresh PR, close the old one as superseded. Recurred 2026-06-26 (scoped-cache: shipped
`fork-feat/scoped-cache-invalidation` → corrected to `v11.10.1-feat/scoped-cache-invalidation`,
#202→#203).

## How to apply

Ask "is this **composed** into the integration branch, or **merged** into prepare?" — NOT
"does it touch CI files". #190 touches blackbox.yml + codecov.yaml + a server.ts hook, but
it is a composed FEATURE (a new capability, stacked on build-tsdown, kept open) → it needs
`v11.10.1-feat: ` so the composer picks it up. #186/187/189 also touched codecov/blackbox
but were prepare-bound config → `ci(...)`.

The #190 error chain (2026-06-23): `fork-feat:` (commit-only prefix, never a PR title) →
`ci(blackbox):` (matched the merged siblings, but missed that they were prepare-MERGED not
composed) → finally `v11.10.1-feat:`. The tell I ignored: base = a `v11.10.1-feat/*` branch
+ kept open = composed = feat prefix.

Related: [[directus-fork-integration-branches]], [[directus-compose-copy-stack]],
[[feedback_name_prs_fully]].
