---
name: project_directus_m2o_filter_needs_no_tag
description: A filter through an M2O terminating on the related primary key needs NO scoped-cache tag at all behind an enforced FK — the widest radius win, gated on relation.schema
metadata:
  type: project
---

`filter[course][id][_eq]=42` on notes joins `course`, but the join only re-reads
`note.course`: the ON clause makes `a1.id` the note's own column. So the condition is
`note.course = 42` plus "a matching row exists", which an enforced FK guarantees.

**Enumerate what a write to the far collection can do — measured on postgres:**
- INSERT — can satisfy the condition, but no near row could already point at a row that
  did not exist, so nothing newly joins. The insert-blindness that forces a bare tag
  elsewhere cannot bite.
- UPDATE of another column — cannot reach the near row's FK.
- UPDATE of the key — the constraint cascades (writing the near row) or refuses.
- DELETE — `CASCADE`/`SET NULL`/`SET DEFAULT` all write the near row (its own collection
  tag purges); `RESTRICT`/`NO ACTION` refuse.

So no tag, **whatever the operator** — `_gt`/`_neq`/`_null` lose their bare tag exactly
as `_eq` loses its pin. The keying calls this `independent`.

**The gate is `relation.schema !== null`** (a real DB constraint). Without one the far
row can be deleted behind the near row's back, leaving a dangling FK that no longer
joins — measured: join form returns nothing, column form returns the row.

**Three guards, each load-bearing and each mutation-tested:**
- m2o only — across a to-many the far row IS read.
- exactly one condition, on the related PK — a sibling on another column reads the far
  row (this guard was VACUOUS until a test was added for it).
- `independent` carries its keys, so a sibling that does read the far row still pins it
  (`{owner: {id: {_eq: 7}, name: {…}}}` → keyed{7}, not bare).

Anything claiming a dependency beats independence in both folds; nested / sorted /
grouped / second-path collections fall through to the tags they had.

Related: [[project_directus_filter_normalization_layers]], [[project_directus_pr402_accepted_exceptions]].
