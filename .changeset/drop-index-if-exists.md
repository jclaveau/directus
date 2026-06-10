---
'@directus/api': patch
---

Fixed schema updates failing when disabling a field's index or unique that no longer physically exists in the database. The drop is now guarded — using each dialect's native `DROP ... IF EXISTS` where available (postgres, sqlite, cockroachdb, mssql, plus knex's `dropUniqueIfExists`) and a catalog existence check on dialects without that syntax (mysql/mariadb, oracle).
