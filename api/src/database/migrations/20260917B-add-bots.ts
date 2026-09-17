import type { Knex } from 'knex';
import { BOTS_ROLE, CACHE_AUDIT_BOT } from '../../bots.js';

/**
 * The first bot: the cache audit (jclaveau/directus#498) replays every live
 * entry as the user it was filled for, and until now signed that token for
 * itself, with nobody named as the actor. It now impersonates as this user
 * (jclaveau/directus#502), so the trail names it and an admin who suspends
 * it stops the audit.
 */
export async function up(knex: Knex): Promise<void> {
	await knex('directus_roles').insert({
		id: BOTS_ROLE,
		name: 'Bots',
		icon: 'smart_toy',
		description: 'Machine actors that act as other users. They never log in.',
	});

	await knex('directus_policies').insert({
		id: CACHE_AUDIT_BOT.policy,
		name: 'Cache audit bot',
		icon: 'smart_toy',
		description: 'What the cache audit may do while replaying an entry as its user.',
		admin_access: false,
		app_access: false,
	});

	await knex('directus_users').insert({
		id: CACHE_AUDIT_BOT.user,
		first_name: 'Cache audit',
		last_name: 'bot',
		role: BOTS_ROLE,
		status: 'active',
	});

	await knex('directus_access').insert({
		id: CACHE_AUDIT_BOT.access,
		user: CACHE_AUDIT_BOT.user,
		policy: CACHE_AUDIT_BOT.policy,
	});
}

export async function down(knex: Knex): Promise<void> {
	await knex('directus_access')
		.where({ id: CACHE_AUDIT_BOT.access })
		.delete();

	await knex('directus_users')
		.where({ id: CACHE_AUDIT_BOT.user })
		.delete();

	await knex('directus_policies')
		.where({ id: CACHE_AUDIT_BOT.policy })
		.delete();

	await knex('directus_roles')
		.where({ id: BOTS_ROLE })
		.delete();
}
