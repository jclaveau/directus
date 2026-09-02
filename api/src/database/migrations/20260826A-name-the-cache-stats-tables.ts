import type { Knex } from 'knex';

/**
 * One prefix for the subsystem, where there were two.
 *
 * The seven tables the cache telemetry writes were measured, reaped and
 * budgeted as one thing while carrying two family names — five
 * `directus_cache_*` and two `directus_scoped_cache_*`, the second pair having
 * arrived with the scoped-cache purge index rather than with the telemetry.
 * Nothing but the order they were built in put them apart.
 *
 * `directus_cache_stats_config_events` takes the prefix like the rest even
 * though it is the one table written whether collection is on or off: the
 * prefix says which subsystem owns the table, not when the table is written.
 * It is budgeted, reaped and read with the others.
 *
 * The two tag tables keep `scoped` in the leaf, because it is true of every row
 * they hold: each one is a single scoped-cache tag, and a purge that dropped no
 * tag contributes none. The subsystem prefix says who owns them; `scoped` says
 * what they are about, and the second is not implied by the first.
 */
const RENAMES: [from: string, to: string][] = [
	['directus_cache_events', 'directus_cache_stats_events'],
	['directus_cache_descriptors', 'directus_cache_stats_descriptors'],
	['directus_cache_anomalies', 'directus_cache_stats_anomalies'],
	['directus_cache_config_events', 'directus_cache_stats_config_events'],
	['directus_cache_purges', 'directus_cache_stats_purges'],
	['directus_scoped_cache_purge_tags', 'directus_cache_stats_scoped_purge_tags'],
	['directus_scoped_cache_entry_tags', 'directus_cache_stats_scoped_entry_tags'],
];

/**
 * Rename each table that is still under its old name and whose new name is
 * free. Metadata only on every dialect here, so the size of the table does not
 * enter into it — and a hypertable keeps its chunks, its compression and its
 * retention policy across the rename, which follow the hypertable rather than
 * its name.
 *
 * The indexes keep the names they were created with. They are addressed by the
 * catalog rather than by hand, and renaming them would be churn for the reader
 * of a `\\d` listing alone.
 */
async function renameEach(knex: Knex, pairs: [string, string][]): Promise<void> {
	for (const [from, to] of pairs) {
		const present = await knex.schema.hasTable(from);
		const taken = await knex.schema.hasTable(to);

		if (!present || taken) {
			continue;
		}

		await knex.schema.renameTable(from, to);
	}
}

export async function up(knex: Knex): Promise<void> {
	await renameEach(knex, RENAMES);
}

export async function down(knex: Knex): Promise<void> {
	await renameEach(
		knex,
		RENAMES.map(([from, to]) => [to, from]),
	);
}
