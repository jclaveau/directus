import type { Knex } from 'knex';

const TABLE = 'directus_scoped_cache_pending_purges';

/**
 * The retry queue aims at a fingerprint, so the column says fingerprint.
 *
 * `scoped_cache_tag` was accurate while a target was one flat
 * `collection:field=value` label. A row now holds a rendered fingerprint — every
 * pin of one query case in a single token — and the drain hands it straight back
 * to the purge as `scopedCacheFingerprints`.
 *
 * The two tag tables the telemetry writes keep the name: what they store really is
 * a legacy tag, the form the `X-Scoped-Cache-Tags` header and the cache page speak.
 *
 * Metadata only on every dialect here, and the table holds rows only between a
 * failed purge and its retry.
 */
async function renameColumnTo(knex: Knex, from: string, to: string): Promise<void> {
	if (!await knex.schema.hasTable(TABLE)) {
		return;
	}

	const present = await knex.schema.hasColumn(TABLE, from);
	const taken = await knex.schema.hasColumn(TABLE, to);

	if (!present || taken) {
		return;
	}

	await knex.schema.alterTable(TABLE, (table) => {
		table.renameColumn(from, to);
	});
}

export async function up(knex: Knex): Promise<void> {
	await renameColumnTo(knex, 'scoped_cache_tag', 'scoped_cache_fingerprint');
}

export async function down(knex: Knex): Promise<void> {
	await renameColumnTo(knex, 'scoped_cache_fingerprint', 'scoped_cache_tag');
}
