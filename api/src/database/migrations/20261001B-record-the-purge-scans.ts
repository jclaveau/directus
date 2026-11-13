import type { Knex } from 'knex';

const TABLE = 'directus_cache_stats_purges';

/**
 * Record which index scans a purge took and how much they read.
 *
 * `duration_ms` is the purge's wall-clock, Redis queueing and event-loop stalls
 * included, so a slow purge could not say whether it read the sets a row's
 * values name or walked every set of its collection. These say it:
 *
 *   - `scan_arms`          — `row`, `declared`, `collection`, `+`-joined when a
 *                            purge ran more than one (`row+collection`)
 *   - `scanned_index_keys` — the index sets those scans read
 *   - `scanned_members`    — the members those sets answered with
 *   - `scan_ms`            — the time spent waiting on the scans' pages
 *
 * Nullable without a default: a namespace clear reads no index, and a row
 * written before this migration was never measured — a 0 would claim a scan
 * that read nothing. Nullable is also what a compressed hypertable accepts as an
 * added column without decompressing a chunk.
 */
export async function up(knex: Knex): Promise<void> {
	if (!await knex.schema.hasTable(TABLE)) {
		return;
	}

	await knex.schema.alterTable(TABLE, (table) => {
		table.string('scan_arms', 32).nullable();
		table.integer('scanned_index_keys').nullable();
		table.integer('scanned_members').nullable();
		table.integer('scan_ms').nullable();
	});
}

export async function down(knex: Knex): Promise<void> {
	if (!await knex.schema.hasTable(TABLE)) {
		return;
	}

	await knex.schema.alterTable(TABLE, (table) => {
		table.dropColumn('scan_arms');
		table.dropColumn('scanned_index_keys');
		table.dropColumn('scanned_members');
		table.dropColumn('scan_ms');
	});
}
