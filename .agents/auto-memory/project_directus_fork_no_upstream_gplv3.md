---
name: project_directus_fork_no_upstream_gplv3
description: jclaveau/directus fork — we no longer submit PRs upstream; fork patches are GPLv3; free to diverge from directus/directus
metadata:
  type: project
---

Stated by jean 2026-06-26: **this fork (`jclaveau/directus`) will NOT submit PRs to upstream
`directus/directus` anymore. The fork's patches are GPLv3.**

**Why:** the fork optimizes for its own (Hippocast/planner) needs, not upstream acceptance.

**How to apply:**
- Free to **diverge from upstream**. Editing `packages/types` (public `AbstractService`/SDK
  contracts), changing public `ItemsService` method signatures/return types, introducing fork-only
  APIs (e.g. `getMeta()` on read results) are all fine — no need to keep changes
  upstream-mergeable or mirror maintainer conventions *for mergeability*.
- Still keep clean diffs/rebases against the **fork's own** base branches (`v11.10.1-*`,
  `v11.10.1-hhh-dev`) and the [[project_directus_pr_title_naming]] / branch conventions — those are
  about the fork's internal integration pipeline, unchanged.
- Prefer typed, consistent solutions over upstream-divergence-avoiding hacks (no more untyped `as any`
  casts chosen *just* to dodge a `packages/types` edit).

**Supersedes the upstream-mergeability goal** in: [[feedback_study_maintainer_prs_before_submitting]],
[[feedback_extract_keep_all_but_upstream_equiv]], [[feedback_patch_source_then_rederive_copy]], and the
`upstream-draft:`/`compare:` PR flows — those were about landing changes upstream, which is no longer a
goal. Their *technical* mechanics (3-way derivation, clean diffs) can still be useful internally; the
*"keep it upstreamable"* constraint is dropped.

License note: record jean's stance (fork = GPLv3). Don't editorialize upstream's license; just treat
fork contributions as GPLv3.
