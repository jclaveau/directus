---
name: reference_directus_dist_repin_lockfile_integrity
description: Re-pinning a consumer lockfile to a new Scalabus `-dist` sha — pnpm will not refresh the tarball integrity; compute it yourself and swap sha + integrity
metadata:
  author: Jean Claveau
  type: reference
---

A consumer pinning `github:jclaveau/directus#<branch>-dist&path:packages/<pkg>` has
gitHosted lockfile entries carrying a tarball `integrity` plus the dist commit sha.
After the dist branch regenerates, the new sha needs a new integrity.

- `pnpm install --update-checksums` does NOT rewrite them.
- Dropping the integrity makes pnpm refuse / leaves the lockfile without it.
- `pnpm update <fork deps>` drags in unrelated tarballs and generated files.
- All entries from the repo share ONE integrity (whole-repo tarball).

**Why:** hit on a consumer PR re-pin after #673 (2026-11-04); three wrong approaches
before this one.

**How to apply:** download the tarball for the new dist sha, compute its sha512
integrity, cross-check it equals pnpm's reported `Actual` from a failed install,
swap sha + integrity in every entry by hand, then `pnpm install --frozen-lockfile`.
Restore generated files the install rewrites (e.g. a barrel `index.d.ts`) before
committing. Dist rebuilds only when the PR has a merge ref — see
[[reference_merge_conflict_blocks_pr_ci]] and [[project_directus_dist_release_label]].
