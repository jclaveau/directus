---
name: project_directus_pr680_merge_gate
description: PR #680 is not mergeable on green CI — jean requires full blackbox tests and a run against the Mollie test environment first
metadata:
  author: Jean Claveau
  type: project
---

Jean, 2026-11-07: "680 will need full bb tests including Mollie test env before being mergeable".

"Full bb" means scenarios for every subscription use case, not the `Run Blackbox Full` vendor matrix: done in `subscription-lifecycle.feature`, 12 scenarios each seen red. In a red run, `syncErrors` and the fakes' received writes leak between scenarios, so only the first red scenario is sure of its reason: re-prove a later one alone.

The scenarios in CI talk to a hand-written fake Mollie ([[project_directus_bb_subscriptions_bundle_scenario]]). The repo has no Mollie secret in Actions (only `CODECOV_TOKEN`, `COMPOSE_SSH_KEY`), so jean provides the `test_` key.

Mollie test mode: DONE 2026-11-07, box ticked. The key lives in `.env.mollie-test` of the subscriptions-bundle worktree (gitignored, never printed). Seen: cancel = DELETE 200 then `canceled` without `nextPaymentDate`; second DELETE and any PATCH answer 422 (no resume: a new subscription with `startDate`); Mollie charges a new subscription on its own ~13 min after creation in test mode (`recurring`); after a cancel the period end is paidAt + 1 month (time of day kept, vs midnight `nextPaymentDate` before). First payment has no `subscriptionId`: jean chose to keep "grants nothing / revoke at once if canceled before the first charge", documented in the code.

**Why:** the fake only answers what was assumed about Mollie, so a green run proves nothing about those assumptions.
**How to apply:** never list #680 as ready to merge on green CI; the gate is the `Before merging` section of its PR body.
