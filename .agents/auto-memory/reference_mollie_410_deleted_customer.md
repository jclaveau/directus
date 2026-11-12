---
name: reference_mollie_410_deleted_customer
description: Mollie answers 410 Gone (not 404) on the subscriptions of a deleted customer; treat 404 and 410 alike as "provider no longer holds it"
metadata:
  type: reference
---

`GET /v2/customers/cst_…/subscriptions/sub_…` for a customer deleted through
`DELETE /v2/customers/cst_…` answers **410**, not 404 (seen live on Mollie test mode, 2026-11-09).
An unknown subscription id on a live customer still answers 404.

`@scalabus/subscriptions` `mapMollieNotFound` (mollie-provider.ts) maps both to
`MissingProviderSubscriptionError`, so the row closes as `canceled` instead of retrying 48 times
(fixed on #680, commit 36aec32ba0).

**How to apply:** any Mollie read that means "is it gone?" checks 404 **and** 410.
See [[project_directus_pr680_merge_gate]].
