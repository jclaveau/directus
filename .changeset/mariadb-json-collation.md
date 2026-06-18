---
'@directus/api': patch
---

Stopped the database charset validation from warning about MariaDB JSON columns. MariaDB has no native JSON type and stores JSON as `LONGTEXT` with the `utf8mb4_bin` collation, which the validator previously reported as a collation mismatch on every startup. The MySQL schema helper now detects MariaDB via `VERSION()` and excludes that expected `LONGTEXT`/`utf8mb4_bin` pairing.
