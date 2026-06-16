---
name: directus-v12-license-dual-compose
description:
  Directus v12+ requires a license key (relicensing); v11.9.2 = last license-free release Hippocast runs, so the fork
  keeps two live integration lines and compose must eventually target both. Current infra targets main only.
metadata:
  type: project
---

Directus **relicensed at v12** — v12+ requires a **license key** to run. `v11.9.2` is the **last license-free release**,
which is what Hippocast deploys.

**Consequence for the fork model:** two integration lines must stay alive in parallel:

- **last-v11 line** (`v11.9.2-hhh-dev` + `-dist`) — the license-free **deployment** line Hippocast actually runs.
- **`main` line** (v12, upstream-tracking) — where the `upstream-draft:` proposals soak (see
  [[directus-fork-integration-branches]]).

**Compose roadmap = dual-target.** The compose / `upstream-diff:` infra (PRs #64 = compose-hhh-main denylist +
release-fork dispatch + `.gitattributes`; #65 = `.agents/` tracking; both opened 2026-06-16) currently targets **`main`
only**. Applying the same compose to the **last-v11 line** is a **deferred later phase** — explicitly out of scope for
the 2026-06-16 work.

`upstream-diff:` = title-prefix class for **fork-permanent** changes that land on `main` but are **never headed
upstream** (vs `upstream-draft:` which aspires to upstream merge). Lands on main because the workflows must live on the
default branch to trigger/dispatch.
