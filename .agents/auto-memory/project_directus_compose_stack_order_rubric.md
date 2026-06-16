---
name: directus-compose-stack-order-rubric
description:
  How to order the upstream-draft PR copies in the hhh-main compose stack (root→leaf) and which PRs are tree roots — the
  ranking rubric driving the rebased hhh-main-stacked tree and compose's auto-proposal.
metadata:
  type: project
---

For composing `hhh-main` the conflicting `upstream-draft:` PRs are reproduced as **rebased copies** (`hhh-main-root:`
isolated / `hhh-main-stacked:` rebased onto its parent copy) so file overlaps resolve once.

## Tree structure

- **Roots = ONLY isolated PRs** — a PR with no file overlap with any other PR (its own size-1 component).
- Every overlapping PR belongs to **one connected component** (bridges: a PR touching two clusters' files links them) →
  a single stack/tree, all `hhh-main-stacked`, base rebased on `main`.

## Order rubric (root = merge first → leaf = merge last)

1. **bugfixes**
2. **perf** (no contract change)
3. **light contract consistency** (e.g. payload/error-type fix, error reasons)
4. **contract changes**, ordered by impact (light → heavy)
5. **refused upstream** (top)

Dependencies override pure rank **only** when a PR's branch literally carries another's code (then the carried PR sits
below). The rubric is also what compose's auto-proposal step should encode (it can't know "refused upstream", so that
tier is human-maintained).

Worked example (2026-06-16, PRs into the fork): roots `#55 #57`; component bottom→top `#54 #48 #60` (bugfix) → `#50`
(perf) → `#62 #61` (payload, reasons) → `#59 #58 #51 #52` (contract light→heavy) → `#46` (refused). See
[[directus-fork-integration-branches]] and [[directus-v12-license-dual-compose]].
