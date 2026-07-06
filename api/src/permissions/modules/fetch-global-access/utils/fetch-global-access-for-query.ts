import type { Accountability, Policy } from '@directus/types';
import { toBoolean, toArray } from '@directus/utils';
import type { Knex } from 'knex';
import { ipInNetworks } from '../../../../utils/ip-in-networks.js';
import type { GlobalAccess } from '../types.js';

type AccessRow = {
	admin_access: Policy['admin_access'] | null;
	app_access: Policy['app_access'] | null;
	ip_access: Policy['ip_access'] | string | null;
	db_connections: Policy['db_connections'] | string | null;
};

export async function fetchGlobalAccessForQuery(
	query: Knex.QueryBuilder<any, any[]>,
	accountability: Pick<Accountability, 'ip'>,
): Promise<GlobalAccess> {
	const globalAccess: GlobalAccess = {
		app: false,
		admin: false,
		dbConnections: [],
	};

	const accessRows = await query
		.select<AccessRow[]>(
			'directus_policies.admin_access',
			'directus_policies.app_access',
			'directus_policies.ip_access',
			'directus_policies.db_connections',
		)
		.from('directus_access')
		// @NOTE: `where` clause comes from the caller
		.leftJoin('directus_policies', 'directus_policies.id', 'directus_access.policy');

	// Additively merge access permissions
	for (const { admin_access, app_access, ip_access, db_connections } of accessRows) {
		if (accountability.ip && ip_access) {
			// Skip row if IP is not in the allowed networks
			const networks = toArray(ip_access);
			if (!ipInNetworks(accountability.ip, networks)) continue;
		}

		// Union the DB connections this policy grants (stored CSV, so `toArray` splits it)
		if (db_connections) {
			for (const name of toArray(db_connections)) {
				if (name && !globalAccess.dbConnections.includes(name)) {
					globalAccess.dbConnections.push(name);
				}
			}
		}

		globalAccess.admin ||= toBoolean(admin_access);
		globalAccess.app ||= globalAccess.admin || toBoolean(app_access);
		if (globalAccess.admin) break;
	}

	return globalAccess;
}
