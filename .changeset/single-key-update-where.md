---
'@directus/api': patch
---

Narrow a single-key `updateMany` to an exact `WHERE pk = ?` instead of `WHERE pk IN (?)`. The single-row form lets the database take a precise record lock rather than the wider range lock an `IN (...)` predicate can acquire, reducing lock contention under concurrent single-item updates (the common `updateOne` path). Behaviour is unchanged; only the emitted SQL and lock granularity differ.
