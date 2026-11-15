import type { Knex } from 'knex';

/** A manager decides for the subscription; a beneficiary only uses it. */
export function listManagedSubscriptions(database: Knex, userId: string) {
	return database('subscription_managers')
		.select('subscription')
		.where('user', userId);
}
