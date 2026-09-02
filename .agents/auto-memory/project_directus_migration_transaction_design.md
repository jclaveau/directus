---
name: project_directus_migration_transaction_design
description: Why the migration runner wraps a run in one transaction on Postgres only, which migrations must stay outside it, and the points already settled on #420/#421 — do not re-raise
metadata:
  type: project
---

`run.ts` wraps a whole `latest()` run in one transaction so a failed upgrade leaves the
schema at the previous release — what the still-serving deployment was built against.
Per-migration was considered and rejected: it strands the database at a version no build
matches. `transactionScope` (`batch` default | `own` | `none`) is the per-migration escape.

**Only Postgres (+cockroachdb) is wrapped.** Both exclusions are measured, not assumed:

- **SQLite cannot.** Its alter-table rebuild runs under an outer transaction as a
  savepoint and invalidates it — `20240204A-marketplace` opens its own transaction, and
  the next migration dies on `RELEASE SAVEPOINT trxNNN; - no such savepoint`.
- **MySQL/MariaDB DDL implicit-commits** either side of every statement, so a wrap buys
  nothing.

**Error-swallowing migrations are incompatible with any outer transaction on Postgres.**
A `try { await knex… } catch {}` around a statement that fails leaves `25P02 current
transaction is aborted` on everything after; the catch stops protecting anything and
merely hides the abort. Five core migrations do this: `20240924A-migrate-legacy-comments`
(fires on EVERY fresh bootstrap), `20210518A`, `20210519A`, `20210802A`, `20240806A`.
Three others (`20220322A`, `20210805B`, `20220325A`) swallow only `JSON.parse` — harmless.

The idiom that keeps the intent inside a batch is a savepoint — `await
knex.transaction(async (trx) => {…}).catch(() => {})`. Nested it emits `SAVEPOINT`;
unwrapped it is a plain transaction and behaves as the bare catch did. `20240924A` uses
it; the other four declare `transactionScope = 'none'` because their paths only fire on
an upgrade that no test here reaches.

**Settled — do NOT re-raise:** whole-run over per-migration; PG-only; the four `'none'`
markings over rewriting untestable logic; `flushCaches(true)` after commit (it publishes
`schemaChanged`); `up()`/`down()` now resolving modules via `getModuleDefault`.

Statements that can never run in a PG/Timescale transaction (measured, TS 2.29.2/PG 18.4):
`CREATE INDEX CONCURRENTLY`, `DROP INDEX CONCURRENTLY`, `REINDEX CONCURRENTLY`, `VACUUM`,
`CLUSTER`, `ALTER TABLE … DETACH PARTITION CONCURRENTLY`, `ALTER SYSTEM`, `DISCARD ALL`,
`CREATE DATABASE`/`TABLESPACE`/`SUBSCRIPTION`, `refresh_continuous_aggregate()`,
`reorder_chunk()`. Silent breakers: `ALTER TYPE … ADD VALUE` then USING the value in the
same transaction, and `CALL`ing a procedure containing `COMMIT`.

See [[project_directus_health_holds_on_outstanding_migrations]].
