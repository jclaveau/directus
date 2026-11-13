---
name: reference_directus_mockclient_pg_dialect_events
description: knex-mock-client with dialect:'pg' makes nested trx/savepoints recurse forever (shared _events) — the vitest workaround, and why the failure hides behind a fallback catch
metadata:
  author: Jean Claveau
  type: reference
---

`knex({ client: MockClient, dialect: 'pg' })` runs `Object.setPrototypeOf(MockClient.prototype, new PgDialect(config))`. Every trx client is `Object.create(client.constructor.prototype)`, so all of them inherit that dialect instance's `_events`; a nested trx/savepoint re-emits `'query'` to itself → "Maximum call stack size exceeded". Without `dialect` nested trx works; a MockClient subclass does not help (its prototype gets replaced, losing the mock methods).

**Fix (in the test's `beforeAll`, with a comment):** `delete Object.getPrototypeOf(MockClient.prototype)._events;`

**Why it bites:** code with `try batch … catch → fallback` swallows the RangeError, so tests silently see the fallback SQL instead of the batch statement — found only by printing the SQL via the fork's compiler through the mock. Needed for any test of `knex.batchUpdate` on a trx (it opens a savepoint). The `dialect` patch is global to the file; put such a `describe` last. Used in [[project_directus_pr634_update_groups_batch]]; see also [[reference_directus_knex_mock_sql_matching]].
