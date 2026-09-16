import type { Knex } from 'knex';
import { getDatabaseClient } from '../index.js';

/**
 * Where a cache audit leaves its report (jclaveau/directus#498).
 *
 * Until now a run answered its caller and was gone: the REST body, the CLI's
 * stdout, a log line for the cron. Only its `stale`/`tag_drift` findings
 * survived, as anomaly rows — one per reason and key, with no run to belong to.
 * That left three questions nothing could answer: did the cron run at all last
 * night, is the stale count trending, and what did the run that flagged this
 * entry see in the other ones.
 *
 * `directus_cache_audits` is one row per run, written when it starts and
 * completed when it ends — so a run in flight is visible as one with no
 * `finished_at`, and a run that failed keeps its `error`. One column per
 * verdict rather than a counts document: a trend is a `SUM` over them.
 *
 * `directus_cache_audit_findings` is one row per entry a run did not judge
 * `fresh`, the whole finding as the report carries it. The JSON columns hold
 * what has no fixed shape (tags, the diff's JSON pointers, the purges the
 * entry survived). `user_id` is the user the entry was filled for, kept as a
 * bare value: a finding outlives the user, and an audit history must not be
 * what stops a user from being deleted.
 *
 * `directus_settings.cache_audit_schedule` is the live cron the cache page
 * edits, laid over `CACHE_AUDIT_SCHEDULE`. `null` means no override; the env
 * rule runs, or nothing does when that is empty too.
 *
 * `directus_cache_stats_descriptors.audited_at` is the audit's place in the
 * cache: a run takes the descriptors least recently audited (never, first)
 * and stamps the ones it passed, so a limited run resumes where the last one
 * stopped. Kept to the millisecond: a run reads what was stamped before it
 * began, and a stamp stored without fractions could sort before the start it
 * came after. The index is what the queue read pages on; Postgres only serves
 * `NULLS FIRST` off an index that sorts its nulls the same way.
 */
export async function up(knex: Knex): Promise<void> {
	await knex.schema.createTable('directus_cache_audits', (table) => {
		table.increments('id');
		table.timestamp('started_at').notNullable();
		table.timestamp('finished_at').nullable();
		// rest | cli | cron | mcp
		table.string('trigger', 8).notNullable();
		// The narrowing the run was asked for: limit, user, collection, purge.
		table.json('options').notNullable();

		table.integer('scanned').notNullable()
.defaultTo(0);

		table.integer('fresh').notNullable()
.defaultTo(0);

		table.integer('stale').notNullable()
.defaultTo(0);

		table.integer('tag_drift').notNullable()
.defaultTo(0);

		table.integer('raced').notNullable()
.defaultTo(0);

		table.integer('time_varying').notNullable()
.defaultTo(0);

		table.integer('expired').notNullable()
.defaultTo(0);

		table.integer('unreplayable').notNullable()
.defaultTo(0);

		table.integer('evicted').notNullable()
.defaultTo(0);

		table.integer('duration_ms').nullable();
		table.text('error').nullable();
		table.index('started_at');
	});

	await knex.schema.createTable('directus_cache_audit_findings', (table) => {
		table.increments('id');

		table
			.integer('audit')
			.unsigned()
			.notNullable()
			.references('id')
			.inTable('directus_cache_audits')
			.onDelete('CASCADE');

		table.string('verdict', 16).notNullable();
		table.string('reason', 64).nullable();
		table.string('redis_key').notNullable();
		table.string('cache_key').notNullable();
		table.string('method', 8).notNullable();
		table.text('url').notNullable();
		table.text('query').notNullable();
		table.string('user_id', 36).nullable();
		table.string('collection').nullable();
		table.timestamp('filled_at').notNullable();
		table.integer('age_ms').notNullable();
		table.json('tags').notNullable();
		table.json('replay_tags').nullable();
		table.json('diff').nullable();
		table.json('purges_since_filled').nullable();
		table.index('audit');
		table.index('verdict');
	});

	await knex.schema.alterTable('directus_settings', (table) => {
		table.string('cache_audit_schedule').nullable();
	});

	await knex.schema.alterTable('directus_cache_stats_descriptors', (table) => {
		table.timestamp('audited_at', { precision: 3 }).nullable();
	});

	if (getDatabaseClient(knex) === 'postgres') {
		await knex.raw(
			'CREATE INDEX directus_cache_stats_descriptors_audit_queue '
			+ 'ON directus_cache_stats_descriptors (audited_at NULLS FIRST, last_filled)',
		);
	}
	else {
		await knex.schema.alterTable('directus_cache_stats_descriptors', (table) => {
			table.index(
				['audited_at', 'last_filled'],
				'directus_cache_stats_descriptors_audit_queue',
			);
		});
	}
}

export async function down(knex: Knex): Promise<void> {
	await knex.schema.alterTable('directus_cache_stats_descriptors', (table) => {
		table.dropIndex(
			['audited_at', 'last_filled'],
			'directus_cache_stats_descriptors_audit_queue',
		);

		table.dropColumn('audited_at');
	});

	await knex.schema.alterTable('directus_settings', (table) => {
		table.dropColumn('cache_audit_schedule');
	});

	await knex.schema.dropTable('directus_cache_audit_findings');
	await knex.schema.dropTable('directus_cache_audits');
}
