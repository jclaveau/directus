export type Migration = {
	version: string;
	name: string;
	timestamp: Date;
};

/**
 * Where a migration commits, declared by the migration itself:
 *
 * - `batch` — the default when a migration declares nothing. Joins the run's
 *   single transaction, so a later failure rolls it back with the rest of
 *   the run.
 * - `own` — commits in a transaction of its own before the run continues.
 *   For work too expensive to discard and redo when a later migration fails.
 * - `none` — runs with no transaction at all. For statements Postgres
 *   refuses inside one, such as `CREATE INDEX CONCURRENTLY` or
 *   `refresh_continuous_aggregate()`.
 *
 * `own` and `none` both end the run's all-or-nothing segment: everything
 * applied before them is committed and can no longer roll back.
 */
export type MigrationTransactionScope = 'batch' | 'own' | 'none';
