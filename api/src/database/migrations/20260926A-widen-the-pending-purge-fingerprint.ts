import type { Knex } from 'knex';

const TABLE = 'directus_scoped_cache_pending_purges';

/**
 * Widen `scoped_cache_fingerprint` to text.
 *
 * `20260818A` created it as a varchar(255) while it held one
 * `collection:field=value` label. A fingerprint holds every pin of one query case
 * plus its `fields=` pair, and passes 255 on an ordinary read, so the insert that
 * records a failed purge fails, and the purge it stood for is never retried.
 *
 * varchar to text is metadata-only on Postgres; SQLite rebuilds the table, which
 * holds rows only between a failed purge and its retry.
 */
export async function up(knex: Knex): Promise<void> {
	if (!await knex.schema.hasTable(TABLE)) {
		return;
	}

	await knex.schema.alterTable(TABLE, (table) => {
		table
			.text('scoped_cache_fingerprint')
			.nullable()
			.alter();
	});
}

export async function down(knex: Knex): Promise<void> {
	if (!await knex.schema.hasTable(TABLE)) {
		return;
	}

	// A row past 255 cannot narrow back, and failing the downgrade over a retry
	// record is worse than losing the retry: the entry stays stale until its TTL.
	await knex(TABLE)
		.whereRaw('length(??) > 255', ['scoped_cache_fingerprint'])
		.delete();

	await knex.schema.alterTable(TABLE, (table) => {
		table
			.string('scoped_cache_fingerprint')
			.nullable()
			.alter();
	});
}
