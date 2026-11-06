---
name: project_directus_issue652_subscriptions_stripe_survey
description: Issue #652 user subscriptions (provider-neutral, Stripe first) — goals jean fixed, and the Stripe-extension survey (none installable, write own) already stored in the issue
metadata:
  author: Jean Claveau
  type: project
---

Issue jclaveau/directus#652 "Support user subscriptions (provider-neutral, Stripe first)", split goals / how / todo. The survey + Stripe best-practice checklist + mermaid sequence diagram live IN the issue (under "How", research only) — do not redo the survey.

Goals jean settled (2026-10-30):
- Subscribers = users for now; data model + provider adapters must not assume a `directus_users` row (orgs later).
- Access granted via policies/roles, maybe policy-based feature flags on top.
- Provider-neutral adapter: verify webhook → common event shape → fetch current subscription.
- Core vs extension: NOT decided, investigate later. Phase is "goals", not "how".

Survey verdict (8 npm packages, code read by 4 subagents, none run): none safe to install; write own. Only `@dmdeveloppement/directus-bundle-stripe` has subscription logic (4/10; hardcoded `admin@dmdev.fr` leak, anon routes, forces `active` on `invoice.paid`). programmarchy/eikaramba: auth bypass when `STRIPE_WEBHOOK_VERIFY_SIGNATURE` unset (default). Four of them mount a global body parser, bypassing `MAX_PAYLOAD_SIZE`.

**Why:** the survey took ~10 agent-minutes; a clean session would redo it.
**How to apply:** open #652 first; add findings there, not as new issues (see [[feedback_directus_oos_feature_gathered_issue]]). Customer Portal recommendation is still unchecked against Stripe docs (a todo in the issue). Public repo: no consumer specifics in the issue ([[feedback_directus_no_consumer_data_in_fork_memories]]).

## Stancer as second provider (checked 2026-10-30, docs.stancer.com/fr + api/openapi.json v2)
- API v2 has NO subscription create/update/cancel route, no product/price routes, no GET /v2/subscriptions/{id}; only GET /v2/customers/{id}/subscriptions (read-only). SubscriptionOut has no period-end field (start_at, free_until, cancel_at only); statuses incomplete/active/past_due/unpaid/canceled.
- Webhooks: HMAC-SHA256 over `<t>.<body>`, header `Stancer-Signature` (t=…,v1=…), 1 min tolerance advised, 15 retries over ~1.5 days, best effort (may be lost, late by hours, duplicated). Events include subscription.created/updated/deleted/past_due/unpaid/canceled/resumed.
- No Idempotency-Key header in the spec. Recurring otherwise = merchant-scheduled charges on a tokenized card / SEPA mandate; card renewal not followed.

## Mollie as second provider (checked 2026-10-30, docs.mollie.com; append `.md` to any page URL for markdown)
- Full Subscriptions API (create/patch/delete under /v2/customers/{cst}/subscriptions), Mollie schedules + retries charges (5× daily, then canceled). Statuses pending/active/canceled/suspended/completed; nextPaymentDate, no period end.
- NO subscription webhooks ("We do not provide webhooks specifically for status changes of a Subscription itself"); only per-payment classic webhooks (unsigned `id=tr_…`, fetch to verify, 10 tries/26h). Next-gen webhooks (beta) are HMAC-signed `X-Mollie-Signature: sha256=…`, no timestamp, 24h dual-header rotation.
- Idempotency-Key header supported (1h cache). Node SDK @mollie/api-client 4.6.0. Verdict in #652: usable second provider; needs a periodic state check.

## Goal added 2026-10-30: plans + recurring free amount (range input 0 → max plan → beyond)
- Stripe `custom_unit_amount` (Checkout "customer chooses price") does NOT support recurring (docs quote). Recurring free amount = inline `price_data` + `recurring` on Checkout line_items or subscription items. Mollie: `amount` free per subscription. Stancer: no.
- Server derives the plan from the bounded amount; fees on 2 € not checked yet (todo in #652).

## Fees tally (added to #652 "### Fees", 2026-10-30)
- EEA consumer card: Stripe 1.5 % + 0.25 € (+0.7 % Billing) vs Mollie 1.80 % + 0.25 € (recurring free) vs Stancer 0.70 % + 0.15 € (floor: premium cards = interchange+scheme+10 %).
- SEPA: Stripe 0.35 € (+0.7 %) vs Mollie 0.35 € vs Stancer 0.25 % + 0.10 € cap 2 €.
- 2 € monthly card ≈ 14 % fees on Stripe/Mollie; yearly billing cuts fees 3–6×. Open todo: decide yearly billing for Supporter.
- Stancer figures from stancer.com/en/pricing-conditions.pdf (pricing page is a JS SPA, numbers not in its bundle).

## Stancer engine on our side (added to #652, 2026-10-30)
- Possible pieces: POST /v2/payments|payment_intents with customer + saved card/sepa, `unique_id` (dedup?), /v2/mandates, `threeds`.
- Blocker: no merchant-initiated / recurring flag in the OpenAPI → off-session card renewals may hit 3DS and fail; SEPA unaffected. Todo: ask Stancer.

## Rulings 2026-11-05 (start once #673 merges, branch from v11.10.1-hhh-dev)
- Core vs ext: a first-party bundle extension shipped as a package, its tables via #673's `defineMigration`.
- Model: provider-neutral, Stripe AND Mollie adapters from the start.
- Status → policies only; feature flags = follow-up.
- Queue: explained (Postgres table + synchronized worker), not ruled yet.
- Queue RULED: PG table keyed by (provider, resource_id) with pending flag, synchronized worker, FOR UPDATE SKIP LOCKED + hourly reconcile; Redis pub/sub only as an optional realtime nudge, never source of truth.
- Status→policy table accepted (active/trialing keep, past_due keep, cancel_at_period_end until end, unpaid/canceled/suspended remove).
- Plans: `subscription_plans` collection in PG is the source of truth (jean). Yearly billing expected.
- Config: env. Own cancel route for both providers. One subscription per subscriber now, door open to several.
- Package lives in `packages/core-extensions/<name>` (home for future core extensions).
- VAT needed; jean thinks own computation beats Stripe Tax. Tests: stripe-mock; Mollie test account.
- Proposed, awaiting jean: subscribers table (B), ownership via subscriptions.access_id FK not a directus_access column, raw-body parser registered in the `middlewares.before` init hook (runs before app.ts's express.json, which skips an already-parsed body).
- 2026-11-05 round 3: subscribers table (B) RULED; package `@scalabus/subscriptions`; own invoices + own VAT RULED; raw body confirmed at implementation. jean wants a fork core PR adding an ownership column to `directus_access` (proposed `managed_by`, awaiting naming go). Open: French-VAT question answered (home VAT only under the EU 10 k€ cross-border B2C threshold), proration explained, awaiting ruling.
- Round 4 RULED: `managed_by` on directus_access (core fork PR, refuse PATCH/DELETE of a managed row unless accountability null; app badge, no remove); proration C (upgrade now, catch-up on next invoice) + downgrade at period end. jean starts as auto-entrepreneur (franchise en base): prices are VAT-inclusive and never change when VAT starts; only invoices show it (293 B mention, then a VAT line).
- managed_by core PR opened: #679 (2026-11-05), the subscriptions bundle stacks on it.
- Round 5 RULED (2026-11-05): own invoices in BOTH HTML and PDF; VAT location evidence (which country a buyer is in) deferred — listed as an open question in the bundle PR description; decisions posted to #652 (body ready, post was blocked by the permission check). #673 merged; the bundle branches off #679's head (stacked) until #679 merges.
- Bundle PR #680 opened 2026-11-05 (base = #679 branch, retarget to hhh-dev once #679 merges); the 19 design questions + deferred VAT location evidence live in its description, not in the package.
- #679 + #680 review rounds ruled and coded (2026-11-05): see [[project_directus_pr679_managed_by]]. Revisions on the subscription tables are dropped, UI included: jean's "go C" chose `subscription_events`, so don't re-offer them (confirmed 2026-11-06).
