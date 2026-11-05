# Design questions

Points where the code forced a choice the design did not settle. Each one is
what the code does today; confirm or rule it otherwise.

## Schema

1. **`subscriptions.customer` FK.** Mollie addresses a subscription as
   `customerId + subscriptionId`, so each subscription row points at its
   `subscriber_customers` row, not only at the subscriber.
2. **Plan references are a child table** (`subscription_plan_references`:
   `plan, provider, reference`, unique on `provider, reference`) rather than one
   column per provider on `subscription_plans`. Stripe's reference is the price
   id; Mollie's is the `metadata.plan` string set at subscription creation.
3. **Unprefixed table names** (`subscribers`, `subscriptions`, …) may collide with
   a consumer's own collections. Prefix them (`scalabus_…`)?
4. **Migration name `20261105A-create-subscription-tables`** is local to the
   bundle; confirm the naming scheme for core-extension migrations.

## Provider mapping

5. **Mollie resource id is composite**: `"<customer id>/<subscription id>"` is
   what the sync queue stores.
6. **Mollie period end is approximated**: `nextPaymentDate` (midnight UTC), else
   the newest paid payment's `paidAt` plus the interval, else `null`. Month
   addition overflows (Jan 31 + 1 month = Mar 3).
7. **Mollie first payments** (no `subscriptionId`, before the subscription
   exists) are refused with a 400, since there is no subscription to sync yet.
   This waits on the checkout flow.
8. **Mollie `completed` maps to `expired`**; Mollie `canceled` maps to
   `cancelAtPeriodEnd = true`, because a Mollie cancel takes effect at once but
   the paid period still runs.
9. **Unhandled Stripe event types are refused with a 400**, so Stripe retries
   them. Subscribe the Stripe webhook only to `customer.subscription.*` and
   `invoice.*`, or should they be acknowledged with a 200?
10. **Stripe subscriptions must have exactly one item**; any other count is a
    sync error.

## Access rules

11. `unpaid`, `suspended` and `expired` revoke access even when
    `cancel_at_period_end` is set.
12. `canceled` keeps access until the period end only when `cancelAtPeriodEnd`
    is set and the period end is in the future. Open edge: a Stripe
    subscription set to cancel at period end, then canceled immediately, still
    reports `cancel_at_period_end: true` and keeps access until the period end.
13. `incomplete`, `incomplete_expired`, `paused` and `pending` have no rule yet:
    the sync fails and retries with backoff, so access is neither granted nor
    revoked.
14. A subscriber whose `user` is null cannot be granted access; the sync fails
    and retries.

## Sync worker

15. **Hardcoded schedule**: sync batch every 10 s, reconcile hourly, at most 50
    rows per batch, retry delay 60 s doubling up to 1 h. Env vars instead?
16. **Reconcile with rows of a disabled provider** enqueues the others, then
    throws naming the disabled providers.
17. **No idempotency keys** on the Stripe cancel call; the Stripe SDK retries
    itself, and the call sets an absolute value.

## Endpoint

18. `POST /subscriptions/cancel` answers 204 and only queues the sync; the
    response does not carry the updated subscription.

## Wiring

19. The bundle is a workspace package; adding it to a deployment (as a
    dependency of the project's `package.json`) is left to the consumer.

## Follow-ups (out of scope for this slice)

- Checkout / subscribe flow.
- Proration: upgrade now with a catch-up charge, downgrade at period end.
- Own invoices (HTML + PDF), VAT: French franchise en base (art. 293 B), later a
  VAT line.
- VAT location evidence.
- App UI.
- Feature flags.
- Redis pub/sub nudge so the worker picks up a webhook before its next tick.
- stripe-mock integration tests in CI: the unit tests build Stripe events with
  `generateTestHeaderString` and spy on the client, which a unit-level harness
  covers without a stripe-mock container; wiring stripe-mock needs a CI service.
