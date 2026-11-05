---
name: feedback_directus_default_matches_dbms
description: IMPORTANT — by default a service query/mutation must behave as the raw SQL would on the DBMS; stricter behaviour (refusals, dedup, ordering guarantees) is opt-in via an option
metadata:
  type: feedback
---

The default behaviour of the query/mutation functions (ItemsService and the other services: `readByQuery`, `createMany`, `updateMany`, `updateBatch`, `upsertMany`, `deleteMany`…) must match what the DBMS does with the equivalent raw SQL. Anything stricter is an opt-in `MutationOptions`/query option, never the default, and REST doesn't set it.

Example (jean, 2026-11-02, #658): `updateMany([1, 2], { tags: { update: [{ id: 7 }] } })` is two `UPDATE … SET test_id = ? WHERE id = 7` in raw SQL: both succeed, last wins, no error unless a unique index exists. So the default is last-wins. `refuseChildJoiningSeveralRows: true` turns it into a 400, for o2m children and existing m2m junction rows alike.

**Why:** callers reason about Directus as SQL; a default that refuses or rewrites what the DB would accept is a hidden contract change. The constraint is the DB's job (a unique index raises the error when one is wanted).

**How to apply:** when a review finding or design asks "refuse or let it through?", the default answer is "what raw SQL does"; offer the strict behaviour as an option, and spell out the raw SQL equivalent in the choice block. Applies to [[project_directus_predating_review_points]]'s o2m last-wins ruling and its flag.
