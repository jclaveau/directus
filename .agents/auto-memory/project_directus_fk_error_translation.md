---
name: project_directus_fk_error_translation
description: PR #287/#288 (MERGED) — enriched InvalidForeignKeyError translation (constraint/relatedCollection/reason/operation, collection:pk, dev-only raw msg); architecture + accepted exceptions (do NOT re-raise in a fresh review)
metadata:
  type: project
---

PR **#288** (MERGED into `v11.10.1-hhh-dev`, squash `3af2d602cb`). Closes #287. Follow-up to
#280/#281 (which routed delete-path DB errors through the translator — do NOT revert that).

**What.** The translated `InvalidForeignKeyError` was less diagnostic than the raw driver
message and mislabeled the delete/RESTRICT direction (named the child, called a still-referenced
error "invalid foreign key"). Fix:
- Widened extensions (`packages/errors/src/errors/invalid-foreign-key.ts`): `constraint`,
  `relatedCollection`, `reason` (`invalid_reference`|`still_referenced`), `operation`
  (`create`|`update`|`delete`). `code` stays `INVALID_FOREIGN_KEY` (no client-contract break).
- `messageConstructor` branches on reason + operation: a blocked delete reads
  `Cannot delete "enrollment:5": it is still referenced by collection "student_enrollment".`
  (`collection:pk` names the exact row when the driver gives its key; **compact form chosen by
  jean**). Falls back to collection-only when the pk is composite (comma in field) or absent, and
  to `Record ... is still referenced ...` on the read path (no operation/collection).
- Threaded a `{ collection, operation }` `DatabaseErrorContext` (`dialects/types.ts`) through
  `translateDatabaseError`/`extractError`; `items.ts` create/update/delete call sites tag it.
  The driver reports the CHILD on a delete; the parent + operation are only known at the call site.
- **Direction is operation-driven, NOT locale-dependent** (round-1 review bug): pg's `detail` is
  localized by `lc_messages`, so `create ⇒ invalid_reference`, `delete ⇒ still_referenced`; only
  `update` (ambiguous) falls back to the detail text. mysql keys off the error CODE
  (`ER_ROW_IS_REFERENCED_2`, locale-independent). sqlite derives reason from operation too.
- **Read-path guard** (round-2 review bug): with no operated collection, a still-referenced
  `collection` stays **null** (parent unknowable) so the message never renders "X referenced by X".
- **Raw driver message**: logged server-side always (`translate.ts` logger.debug) + attached to
  `extensions.databaseError` **dev-only** (mirrors `stack`, non-enumerable rider) — it's the
  SQL+values #281 keeps out of prod.

**Scope + accepted exceptions — settled, do NOT re-raise:**
- **pg / mysql+mariadb / sqlite only** (the deploy matrix). **mssql + oracle unchanged** — keep the
  old 3-field agenda; threading operation there is a follow-up. No regression.
- **Non-English pg UPDATE** that is actually still-referenced can still mislabel (falls to detail
  text; narrow — Directus rarely mutates a referenced PK). Documented limit.
- **mysql tick-position parsing** assumes the `` `db`.`table` `` schema-qualified prefix; only
  `ER_ROW_IS_REFERENCED_2` (1451) caught, not the detail-less 1217. Pre-existing fragility.
- **`extensions.value` typed `string|null`** but receives numbers at runtime (template-coerced) —
  pre-existing loose type, not introduced here.
- **No prod raw-message leak** (non-enumerable + dev-gated), **full operation coverage** (all write
  leaves funnel through create/update/delete), **no signature regressions** — verified, don't re-audit.

Reviewed via 2 adversarial subagent rounds; each found a real bug (locale, read-path self-reference).
Blackbox `db-error-translation.test.ts` (pg + sqlite3) asserts the messages end-to-end. Related:
[[project_directus_forbidden_error_conventions]], [[project_directus_blackbox_run_and_logs]].
