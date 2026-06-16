---
name: directus-db-clients-and-returning-support
description: Canonical Directus DB client list lives in api/src/types/database.ts; which clients return all IDs after batch insert vs. only the last
metadata:
  type: project
---

The 7 Directus DB clients are defined in `api/src/types/database.ts:3`:

```
DatabaseClients = ['mysql', 'postgres', 'cockroachdb', 'sqlite', 'oracle', 'mssql', 'redshift']
```

MariaDB is **not** a distinct client — it rides under the `mysql` client (via the mysql2 driver).

Batch-insert ID return behavior (relevant to `ItemsService.createMany` fallback at `api/src/services/items.ts:823` / `:862`):

- **Return all inserted IDs** (`.returning(pk)` works end-to-end):
  - postgres — native `INSERT ... RETURNING`
  - cockroachdb — Postgres-compatible
  - redshift — Postgres-derived, same RETURNING semantics
  - mssql — `OUTPUT INSERTED.*`
  - oracle — `RETURNING ... INTO`

- **Return only the last inserted ID** — triggers the fallback loop that re-queries by PK desc:
  - mysql — no RETURNING; knex returns `LAST_INSERT_ID()` (first row of batch)
  - mariadb (under `mysql` client) — server supports `INSERT ... RETURNING` since 10.5, but knex's mysql2 driver path doesn't use it, so it behaves like MySQL
  - sqlite — engine supports RETURNING since 3.35, but knex's batchInsert path only surfaces the last lastID

**Why:** answering DB-capability questions about Directus by reciting generic SQL knowledge produced an imprecise answer (omitted Redshift, miscounted MariaDB as a separate client). Grounding on the source file gives the right list.

**How to apply:** when asked which DBMSes Directus supports — or how a given DB capability behaves across them — open `api/src/types/database.ts` first, and remember that Knex's driver path is the gate, not just raw DB capability.
