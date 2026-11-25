import type { Knex } from 'knex';

/**
 * Who really acted when a token was minted for someone else
 * (jclaveau/directus#502).
 *
 * `directus_sessions.impersonator` names the user a session was opened by, and
 * cascades with them: a deleted impersonator takes the impersonation down.
 * `impersonator_session` is the impersonator's own session token, kept so a
 * Data Studio "Stop" can re-sign their cookie from it. `endSessions` follows
 * it on purpose (the trail and the socket kick need the row before it goes);
 * the cascade is only the net under a row deleted by other means.
 *
 * `directus_activity.impersonator` keeps `user` as the target and names the
 * impersonator beside it, bare like `user` has been since `20201028A`: a trail
 * outlives the accounts it names.
 */
export async function up(knex: Knex): Promise<void> {
	await knex.schema.alterTable('directus_sessions', (table) => {
		table.uuid('impersonator')
			.nullable()
			.references('id')
			.inTable('directus_users')
			.onDelete('CASCADE');

		table.string('impersonator_session', 64)
			.nullable()
			.references('token')
			.inTable('directus_sessions')
			.onDelete('CASCADE');
	});

	await knex.schema.alterTable('directus_activity', (table) => {
		table.uuid('impersonator').nullable();
	});
}

export async function down(knex: Knex): Promise<void> {
	await knex.schema.alterTable('directus_activity', (table) => {
		table.dropColumn('impersonator');
	});

	await knex.schema.alterTable('directus_sessions', (table) => {
		table.dropColumn('impersonator_session');
		table.dropColumn('impersonator');
	});
}
