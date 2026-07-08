---
name: feedback_directus_new_feat_base_hhh_dev
description:
  New feature work on jclaveau/directus now bases directly on v11.10.1-hhh-dev (the work branch, no more
  v11.10.1-feat/* chain branches); always fetch + sync hhh-dev to its latest tip BEFORE starting a new feat
metadata:
  type: feedback
---

**`v11.10.1-hhh-dev` is now THE work branch for new features** (user, 2026-06-26). New feat work bases
directly on it — not on a fresh `v11.10.1-feat/<name>` chain branch (the linear-chain / leaf-PR model in
[[project_directus_linear_chain_leaf_pr]] is how hhh-dev was *built*; going forward feats branch off hhh-dev
itself). A feature branch off hhh-dev → PR into hhh-dev.

**ALWAYS ensure hhh-dev is up to date before beginning a new feat:** `git fetch origin` then branch off / reset
to `origin/v11.10.1-hhh-dev`. Don't start on a stale local branch.

**Why:** hhh-dev moves (leaf-PR merges, dist builds, fork-CI edits). Starting on a stale base means re-porting
later. It carries the fork CI layer + `.agents` an integration branch needs.

**How to apply:**
- Before any new Directus feat: `git fetch origin && git switch -c <feat> origin/v11.10.1-hhh-dev` (or update an
  existing hhh-dev checkout first).
- Branch naming seen in practice: `v11.10.1-hhh-dev_<feature>` (underscore, mirrors the `v11.9.2-hhh-dev_*`
  remote pattern).
- Worktree note: a fresh worktree off hhh-dev has NO node_modules and may miss hhh-dev-only deps (e.g.
  `stream-json`) — symlinking the main tree's node_modules runs cache-only unit tests but breaks anything
  importing those deps ([[reference_agent_worktree_no_node_modules]]); full suite → real install or CI.

**Session lesson (2026-06-26):** built the scoped-cache value-tags feature on `fork-feat/scoped-cache-invalidation-v11`
(branched off the clean v11.10.1 tag, 62 commits behind hhh-dev) → had to cherry-pick onto a branch off
hhh-dev after the fact. The port was near-clean (cache.ts/items.ts auto-merged; only a `cache.test.ts`
add/add conflict to merge with hhh-dev's `getRedisConnection` tests) precisely *because* hhh-dev already
carried equivalent content — but the whole detour was avoidable by starting on hhh-dev. Result branch:
`v11.10.1-hhh-dev_scoped-cache-value-tags`. Supersedes the "new feat = new `v11.10.1-feat/*` branch"
guidance in [[directus-fork-integration-branches]].
