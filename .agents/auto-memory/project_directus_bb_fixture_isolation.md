---
name: project_directus_bb_fixture_isolation
description: Adding a relation field to a collection an existing blackbox test reads with fields=* joins it into EVERY read in that file — put new fixtures on their own collections
metadata:
  type: project
---

`convertWildcards` splices **every** field of a collection into `fields=*`, alias fields
included. So adding one relation to a collection an existing test reads wholesale changes
what that test's response nests, and therefore its tags.

**Why:** on #402 I added a second o2m alias (`alt_children`) onto the `PARENT` collection
to reach the o2m pin's "two paths disagree on the reverse fk" branch. Every read in
`cache-o2m-child-pin.test.ts` uses `fields: '*,children.*'`, so the new alias joined all
of them, the child collection became permanently `conflicted`, and **four unrelated tests
went red**. Moving the pair to their own `CONFLICT_PARENT`/`CONFLICT_CHILD` collections
fixed it with no change to the existing cases.

**How to apply:**
- New relational fixture for one new scenario → its own collections, named for the
  scenario. Never hang it off a collection an existing test reads with `*`.
- I had already applied this reasoning once the same day (putting an A2O and a
  second-owner-path fixture on a separate `PAGE` collection) and failed to carry it over
  to someone else's file — check the sibling tests' `fields` before extending a fixture.
- Teardown order: drop the junction/child before the collections it points at.

Related: [[feedback_regression_test_avoid_fragile_shared_state]], [[project_directus_blackbox_single_file_locally]].
