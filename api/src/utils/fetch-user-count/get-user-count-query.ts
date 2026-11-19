import type { PrimaryKey } from '@directus/types';
import type { Knex } from 'knex';

export interface GetUserCountOptions {
	excludeIds?: PrimaryKey[];
	excludeRoles?: PrimaryKey[];
	includeRoles?: PrimaryKey[];
}

/** A user counts once, whatever number of the roles it is a member of. */
function membershipQuery(knex: Knex, roleKeys: PrimaryKey[]) {
	return knex
		.select(knex.raw('1'))
		.from('directus_role_members')
		.whereRaw('?? = ??', [
			'directus_role_members.user',
			'directus_users.id',
		])
		.whereIn('directus_role_members.role', roleKeys);
}

export function getUserCountQuery(knex: Knex, options: GetUserCountOptions) {
	// Safety check for an empty list of includeRoles, which would otherwise return all users
	if (options.includeRoles && options.includeRoles.length === 0) {
		return Promise.resolve({ count: 0 });
	}

	let query = knex('directus_users').count({ count: '*' }).as('count').where('status', '=', 'active');

	if (options.excludeIds && options.excludeIds.length > 0) {
		query = query.whereNotIn('id', options.excludeIds);
	}

	if (options.excludeRoles && options.excludeRoles.length > 0) {
		query = query.whereNotExists(
			membershipQuery(knex, options.excludeRoles),
		);
	}

	if (options.includeRoles && options.includeRoles.length > 0) {
		query = query.whereExists(membershipQuery(knex, options.includeRoles));
	}

	return query.first();
}
