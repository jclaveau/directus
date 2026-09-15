---
name: project_directus_blackbox_shared_migration_versions
description: directus_migrations is shared across a blackbox shard, so two suites staging the same far-future version silently break each other
metadata:
  type: project
---

`directus_migrations` lives in the shard's shared database, so a migration
*version* is a global name across every test file in that shard — even when each
suite stages its file in its own temp `EXTENSIONS_PATH`.

`tests/db/database/migration-transaction.test.ts` applies and records `20990101A`.
`tests/db/routes/server/health-outstanding-migrations.test.ts` staged a
never-applied file under the same version, and the two sit adjacent in shard 7.
Whenever the transaction suite recorded the version first, the health instance
polled, found it already applied and reported healthy — three failures reading
`expected 200 to be 503` and `expected undefined to deeply equal [Array(1)]`,
none of them about the guard under test. Fixed on PR #465 by moving the health
suite to `20990201A`.

**Why:** the symptom points at the feature (`/server/health`, the migration
watch), not at the neighbour that wrote the row, and it survives a rerun — two
consecutive identical failures look like a real regression rather than a race.

**How to apply:** a new blackbox suite that writes to `directus_migrations` picks
a version no other file uses — grep `2099[0-9]\{4\}` across `tests/blackbox`
first. When a shard-local suite fails deterministically but an earlier head of
the same PR passed, **rerun that earlier head as a control** before blaming the
diff; here the control came back green and cleared a diff that touched only a
unit test and an eslint config. See [[feedback_ci_attribute_via_base_sha]] and
[[project_directus_blackbox_spawn_own_instance]].
