---
name: project_directus_pr680_merge_gate
description: PR #680 is not mergeable on green CI — jean requires full blackbox tests and a run against the Mollie test environment first
metadata:
  author: Jean Claveau
  type: project
---

Jean, 2026-11-07: "680 will need full bb tests including Mollie test env before being mergeable".

The scenario in CI talks to a hand-written fake Mollie ([[project_directus_bb_subscriptions_bundle_scenario]]). The repo has no Mollie secret in Actions (only `CODECOV_TOKEN`, `COMPOSE_SSH_KEY`), so jean provides the `test_` key.

To check on the Mollie test mode: `canceled` with the paid period still running, and whether a canceled subscription can be resumed (docs: "Canceled subscriptions cannot be updated").

**Why:** the fake only answers what was assumed about Mollie, so a green run proves nothing about those assumptions.
**How to apply:** never list #680 as ready to merge on green CI; the gate is the `Before merging` section of its PR body.
