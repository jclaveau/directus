---
name: project_directus_blackbox_cucumber_step_order
description: blackbox jest-cucumber binds step definitions BY POSITION — a steps callback shared across scenarios must define steps in every scenario's order, or the whole file fails at load
metadata:
  type: project
---

`@common/cucumber`'s `.optional` only filters out definitions a scenario does not
hold; jest-cucumber then binds the rest **by position**. So in a steps callback
shared by several scenarios, the definitions a scenario uses must appear in the
exact order of its steps. The step keyword (Given/And) is irrelevant; order is not.

Failure signature (whole FILE fails at load, `[ file ]`, zero tests run):
`Expected step #1 in scenario "…" to match "…". Try adding the following code:`
listing several step numbers. In a shard it also cascades: every serial `after`
file behind it dies on `Hook timed out in 600000ms` (the completion barrier).

Seen 2026-09-29 on PR #581: the first red-proof run was INVALID — it failed at
load, not on the reverted fix, so it proved nothing and would have been red on the
real head too ([[feedback_failed_probe_may_be_invalid_not_refuting]]).

`.optional` decides by the step's TEXT, never its keyword: an optional `and` whose
matcher also fits the `Given` line (`/^the rows of (\S+):$/` twice) binds in every
scenario → `has 2 step(s) in the feature file, but 3 step definition(s)` at load.
Give the optional a matcher only its own line fits (PR #387, 2026-10-08, the
update-batch-guards file; it cost shard 1 a 600 s after-chain hang).

**How to apply:** when adding a scenario to an existing `.feature`, order its steps
to follow the definition order (or move definitions). Check offline before pushing:
for each scenario, list definitions whose matcher fits one of its steps, in source
order, and compare to its step list — a 20-line python script did it and flagged
the broken version as a control. Related: [[project_directus_blackbox_run_and_logs]].
