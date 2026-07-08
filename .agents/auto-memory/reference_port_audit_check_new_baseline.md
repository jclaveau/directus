---
name: reference_port_audit_check_new_baseline
description: when auditing "which fork patches are unported", also diff against the NEW upstream baseline — upstream-merged patches get absorbed into the newer base tag and look falsely MISSING
metadata:
  type: reference
---

Auditing fork-feature port status (e.g. v11.9.2-hhh-dev → v11.10.1 stack): comparing only the fork-delta (`newTag..forkBranch`) gives FALSE "MISSING" for any patch that was merged UPSTREAM between the two base tags — it's already in the newer baseline, so the fork no longer needs to carry it.

Concrete: jean's SDK catchable-error patch (`message` prop on DirectusError) showed as MISSING because the v11.10.1 stack touches no `sdk/`. But PR #25474 merged upstream 2025-07-21, v11.10.1 tagged 2025-08-11 → already in `v11.10.1:sdk/src/utils/request.ts`. Cherry-pick of the squash commit `cc29b626ab` onto v11.10.1 committed only the stray `.changeset` file (everything else auto-merged as already-present) — the tell.

Audit recipe:
- Enumerate jean's merged-upstream PRs: `gh pr list -R directus/directus --author "@me" --state merged`.
- For each, compare merge date vs the new base tag date (`git show -s --format=%ci <tag>`). Merged-before-tag = absorbed into baseline = NOT a gap.
- jean's only merged-upstream PRs: #25474 (sdk message, in v11.10.1 baseline), #23907 (readByQuery thousands-nested, merged 2024-12, in both baselines). Everything else in the fork is un-upstreamed → genuinely needs porting.

SECOND blind-spot (found same session): the diff REFERENCE branch matters. The v11 port effort is a stacked-PR LINEAR CHAIN targeting `v11.10.1-prepare` (#115 tsdown→#114 extensions-rolldown→#190→…→#192 leaf→hhh-dev, see [[project_directus_linear_chain_leaf_pr]]). Diffing only the `v11.10.1-hhh-dev` TIP or an isolated tag-based mirror (e.g. `fork-feat/batch-insert-v11`, branched off the v11.10.1 TAG) MISSES every feature that lives in an unmerged upstream-of-it PR. The whole tsdown/rolldown build migration (9.2 audit items #7 sdk-build, #8 extensions-build) false-flagged MISSING this way — it's actually shipped in open PRs #115/#114. Before declaring MISSING, also check `gh pr list -R jclaveau/directus --state open --search '<keyword>'` and grep the feat-branch heads (`origin/v11.10.1-feat/*`), not just the chain tip.

See [[reference_cross_major_version_feature_port]], [[feedback_extract_keep_all_but_upstream_equiv]] (the "skip only upstream-equivalent" rule — this is the mechanism for detecting upstream-equivalent).
