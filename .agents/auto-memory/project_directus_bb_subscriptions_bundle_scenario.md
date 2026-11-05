---
name: project_directus_bb_subscriptions_bundle_scenario
description: PR #680 blackbox scenario for managed_by access (jean ruling 8=B) — spawned instance loading the subscriptions bundle, fake Mollie via preload, and the index-signature typecheck trap
metadata:
  author: Jean Claveau
  type: project
---

Jean ruled (#679 review, point 8 = B): the managed-access guard is proven by a blackbox scenario in **PR #680**, where a subscription really grants access row X. No DB-seed hack of `managed_by`.

- Shape: spawned instance with the bundle symlinked from `packages/core-extensions/subscriptions`, fake Mollie says active, `POST /subscriptions/webhooks/mollie` (`id=tr_x`), poll until the access row has `managed_by`, then the refusals (nested `PATCH /users/U {policies:{delete:[X]}}`, `DELETE /access/X`, `PATCH /access/X`), round trip 200, suspended/canceled → bundle deletes the row.
- Fake provider: Mollie client has no env endpoint, so a test-only `NODE_OPTIONS=--import` preload reroutes `https.request` for `api.mollie.com` to a local HTTP server (drop the custom https `agent`). Preferred over adding a production `SUBSCRIPTIONS_MOLLIE_API_ENDPOINT`.
- Green since `75a88823f2`. A spawned instance's output is in the run's artifact `blackbox-server-logs-<vendor>-<shard>`, `server-logs/start-*.log`: read it first on a 404, a failed bundle registration is only a WARN there.
- Traps it hit: `@mollie/api-client` is CommonJS, so under Node's ESM its default import is the exports object: import it by name (vitest resolves its ESM build, unit tests never see this). `getUrl(vendor, env)` wants the whole env map, not one vendor's. `writeExtensionPackage` now creates the scope folder.
- Typecheck trap: `managed_by` read off an index-signature type needs bracket access (`row['managed_by']`); CI typecheck went red on #679 (`c097ca2424` fixed it) while unit tests were green.

**Why:** a unit test mocks the guard's inputs; only a real bundle write proves the guard sees the real `managed_by`.
**How to apply:** reopening #680 CI or extending the scenario. See [[project_directus_pr679_managed_by]], [[project_directus_blackbox_cucumber_step_order]].
