//#region src/utils/cache-entry-verified-at.ts
/**
* When a cache entry was last known to answer what the database does, as SQL
* over its descriptor: its last audit, or its fill where that came later — a
* fill reads the database, so the body it wrote matched it then. Spelled out
* as a CASE rather than GREATEST, which answers null beside a null on MySQL
* and SQLite; and one spelling, because the Postgres index the audit queue
* pages on is built over this very expression.
*/
const CACHE_ENTRY_VERIFIED_AT = "CASE WHEN audited_at IS NULL OR audited_at < last_filled THEN last_filled ELSE audited_at END";

//#endregion
export { CACHE_ENTRY_VERIFIED_AT };