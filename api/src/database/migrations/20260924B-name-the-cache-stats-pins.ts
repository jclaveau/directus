import type { Knex } from 'knex';

/**
 * The telemetry stores one pin per row, so the tables and columns say pin.
 *
 * `tag` was the word for `collection[:field=value]` before #531, when a read was
 * filed under a SET of them and any one matching purged it. A row here has always
 * held exactly that string, and still does — `scopedCachePinKey`, one axis of one
 * collection. What changed is that the word now names something else: an entry is
 * filed under fingerprints, the AND of the pins that hold together on a row, and
 * a reader seeing `tag` beside `directus_scoped_cache_pending_purges`'s
 * `scoped_cache_fingerprint` has no way to tell they are different shapes.
 *
 * A fingerprint cannot go in these columns. The purge-coverage join is an
 * equality between what an entry was filled under and what a purge named, and the
 * two sides build their fingerprints from different halves: a read's carries the
 * `viewFields` its response was projected on, a write's cannot know them. Their
 * pins, on the other hand, are the same strings — which is why the join has always
 * been written on them, and why what it measures is a reach rather than an
 * eviction: a purge naming `owner=7` covers an entry pinned on `owner=7` only if
 * the entry's other pins held for that write too, which since #531 it need not
 * have. What the page reports is therefore an upper bound, as it was before this
 * rename — measuring the evictions themselves needs the purge to record the keys
 * it dropped, which is a fact table this migration does not build.
 *
 * `tag_drift` goes with them: the audit compares an entry's pins against the pins
 * its replay resolved, so the verdict is a pin drift. Its stored values are
 * rewritten here rather than left behind — a dashboard filtering on the verdict
 * would otherwise show two names for one finding, split across the migration.
 *
 * Metadata only, and measured against timescaledb 2.30.1 on nine compressed
 * chunks: a hypertable carries its compression settings across both a column and
 * a table rename, so `compress_orderby = 'scoped_cache_tag, time DESC'` follows
 * the column rather than its name.
 */
const TABLE_RENAMES: [from: string, to: string][] = [
	[
		'directus_cache_stats_scoped_purge_tags',
		'directus_cache_stats_scoped_purge_pins',
	],
	[
		'directus_cache_stats_scoped_entry_tags',
		'directus_cache_stats_scoped_entry_pins',
	],
];

const COLUMN_RENAMES: [table: string, from: string, to: string][] = [
	[
		'directus_cache_stats_scoped_purge_pins',
		'scoped_cache_tag',
		'scoped_cache_pin',
	],
	[
		'directus_cache_stats_scoped_entry_pins',
		'scoped_cache_tag',
		'scoped_cache_pin',
	],
	[
		'directus_cache_stats_purges',
		'scoped_cache_tag_count',
		'scoped_cache_pin_count',
	],
	['directus_cache_audits', 'tag_drift', 'pin_drift'],
	['directus_cache_audit_findings', 'tags', 'pins'],
	['directus_cache_audit_findings', 'replay_tags', 'replay_pins'],
];

/** The stored verdict and anomaly reason, which name the same finding. */
const VALUE_RENAMES: [table: string, column: string, from: string, to: string][] = [
	['directus_cache_audit_findings', 'verdict', 'tag_drift', 'pin_drift'],
	['directus_cache_stats_anomalies', 'reason', 'tag_drift', 'pin_drift'],
];

async function renameTables(knex: Knex, pairs: [string, string][]): Promise<void> {
	for (const [from, to] of pairs) {
		const present = await knex.schema.hasTable(from);
		const taken = await knex.schema.hasTable(to);

		if (!present || taken) {
			continue;
		}

		await knex.schema.renameTable(from, to);
	}
}

async function renameColumns(
	knex: Knex,
	triples: [string, string, string][],
): Promise<void> {
	for (const [table, from, to] of triples) {
		if (!await knex.schema.hasTable(table)) {
			continue;
		}

		const present = await knex.schema.hasColumn(table, from);
		const taken = await knex.schema.hasColumn(table, to);

		if (!present || taken) {
			continue;
		}

		await knex.schema.alterTable(table, (alter) => {
			alter.renameColumn(from, to);
		});
	}
}

async function renameValues(
	knex: Knex,
	quads: [string, string, string, string][],
): Promise<void> {
	for (const [table, column, from, to] of quads) {
		if (!await knex.schema.hasTable(table)) {
			continue;
		}

		await knex(table)
			.where(column, from)
			.update({ [column]: to });
	}
}

export async function up(knex: Knex): Promise<void> {
	await renameTables(knex, TABLE_RENAMES);
	await renameColumns(knex, COLUMN_RENAMES);
	await renameValues(knex, VALUE_RENAMES);
}

export async function down(knex: Knex): Promise<void> {
	await renameValues(
		knex,
		VALUE_RENAMES.map(([table, column, from, to]) => [table, column, to, from]),
	);

	await renameColumns(
		knex,
		COLUMN_RENAMES.map(([table, from, to]) => [table, to, from]),
	);

	await renameTables(
		knex,
		TABLE_RENAMES.map(([from, to]) => [to, from]),
	);
}
