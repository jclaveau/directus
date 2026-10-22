---
name: project_directus_planner_domain_e2e_residue
description: Planner apps/domain local e2e reds from fixed-name fixtures colliding with leftover DB rows across runs — state pollution, not code regressions
metadata:
  type: project
---

Two `apps/domain` e2e failure families traced to local-DB residue, confirmed
NOT present in CI (same commits pass clean there):

- **`grouped-notification`** — all three scenarios in
  `grouped-notifications.feature` seed the same fixed emails
  (`…recipient-0@example.com`, etc, via `notifying-background.ts`). When one
  scenario's 20-user cleanup blows its cleanup hook, its rows survive and the
  next run's create collides: `RECORD_NOT_UNIQUE directus_users.email`. Fixed
  by deleting the stray rows through the admin API once; a real fix (each
  scenario gets its own email namespace) was offered, not done — say the word.
- **`proposed-cursus`** — teardown can't drop its fixtures when they're still
  referenced (`Cannot delete "course:11322": still referenced by
  "student_course"`), so stale published courses leak into the next run's
  "proposed and not already added" list and rename-suffix collide
  (`"Cours de droit" => "Cours de droit 2"`). Same family: fixtures whose
  cleanup can fail under fixed names the next run then collides with.

Separately, `delete-my-account`'s `Hook timed out in 20000ms` under full-suite
load was a **real bug**, now fixed (`7c7ed2dc`): `jest-after-this` runs every
registered `afterEach` callback serially in one hook (see
[[reference_jest_after_this_serial_hooks]]), so the three cascading deletes it
registered summed their time against one 20s budget instead of running
concurrently. Fixed by collecting the removals and firing them with
`Promise.all` in a single hook registration — `directus_users` has exactly
one DB-level FK (`role`), `avatar` isn't constrained, so concurrent deletion
is safe. Confirmed by the run that had actually reproduced the failure (a
2-file pairing had passed even before the fix, so it wasn't proof).

**How to apply:** a local `apps/domain` red in these three files is domain
residue, not a fork-bump or code regression, until CI also shows it red.
Clearing 20+ stray `tests-…@example.com` users via `DELETE /users` (admin
API) unblocks a local rerun immediately.
