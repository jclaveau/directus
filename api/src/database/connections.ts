import { useEnv } from '@directus/env';
import type { Accountability } from '@directus/types';
import type { Knex } from 'knex';
import { merge } from 'lodash-es';
import { getConfigFromEnv } from '../utils/get-config-from-env.js';
import getDatabase, { constructDatabase } from './index.js';

// One knex per named connection, built lazily and memoized for the process
// lifetime — like getDatabase() memoizes the default pool. Keyed by name, not
// config: a name maps to one config per run (env is immutable in prod; bb tests
// must not reuse a name with a different config).
const namedDatabases = new Map<string, Knex>();

/**
 * Name of the default pool (`DB_DEFAULT_CONNECTION_NAME`); policies may grant
 * it too.
 */
export function getDefaultConnectionName(): string {
	const name = useEnv()['DB_DEFAULT_CONNECTION_NAME'];

	return typeof name === 'string'
		? name
		: 'default';
}

/**
 * Names of the extra connections from `DB_CONNECTIONS` (array when cast, CSV
 * at runtime).
 */
export function getExtraConnectionNames(): string[] {
	const value = useEnv()['DB_CONNECTIONS'];

	if (Array.isArray(value)) {
		return value.map(String).filter(Boolean);
	}

	if (typeof value === 'string') {
		return value
			.split(',')
			.map((name) => name.trim())
			.filter(Boolean);
	}

	return [];
}

/** Base `DB_*` config, with every named-connection namespace stripped off. */
export function getBaseDbConfig(): Record<string, any> {
	const connectionPrefixes = getExtraConnectionNames().map(
		(name) => `DB_CONNECTION_${name.toUpperCase()}_`,
	);

	return getConfigFromEnv('DB_', {
		omitPrefix: [
			'DB_EXCLUDE_TABLES',
			'DB_DEFAULT_CONNECTION',
			...connectionPrefixes,
		],
		omitKey: [
			'DB_BATCH_INSERT_CHUNK_SIZE',
			'DB_MSSQL_TRUST_BATCH_RETURNING',
			'DB_CONNECTIONS',
		],
	});
}

/**
 * Priority of a connection (`_PRIORITY` env); higher wins. Default pool has
 * its own knob.
 */
export function getConnectionPriority(name: string): number {
	const key =
		name === getDefaultConnectionName()
			? 'DB_DEFAULT_CONNECTION_PRIORITY'
			: `DB_CONNECTION_${name.toUpperCase()}_PRIORITY`;

	const priority = useEnv()[key];

	return typeof priority === 'number'
		? priority
		: 0;
}

/** Connection names must be unique (default + `DB_CONNECTIONS`); else boot fails. */
export function assertConnectionNamesAreUnique(): void {
	const seen = new Set([getDefaultConnectionName()]);

	for (const name of getExtraConnectionNames()) {
		if (seen.has(name)) {
			throw new Error(
				`Duplicate DB connection name "${name}" — names must be unique`,
			);
		}

		seen.add(name);
	}
}

/**
 * Resolve the connection name a request should use: the highest-priority
 * among the default pool (always a candidate) and the configured connections
 * the user's policies grant. Ties break by name, so a winner must outrank
 * `DB_DEFAULT_CONNECTION_PRIORITY`.
 */
export function getConnectionNameForAccountability(
	accountability?: Accountability | null,
): string {
	const defaultName = getDefaultConnectionName();
	const extra = getExtraConnectionNames();

	const candidateNames = new Set<string>([defaultName]);

	for (const name of accountability?.grantedDbConnections ?? []) {
		if (name === defaultName || extra.includes(name)) {
			candidateNames.add(name);
		}
	}

	// Default is always a candidate → array never empty; reduce keeps `best` set.
	const best = [...candidateNames]
		.map((name) => ({ name, priority: getConnectionPriority(name) }))
		.reduce((winner, candidate) => {
			const winsByName =
				candidate.priority === winner.priority &&
				candidate.name.localeCompare(winner.name) < 0;

			return candidate.priority > winner.priority || winsByName
				? candidate
				: winner;
		});

	return best.name;
}

/**
 * The knex a request uses (default name → base pool; named pools build
 * lazily).
 */
export function getDatabaseForAccountability(
	accountability?: Accountability | null,
): Knex {
	const name = getConnectionNameForAccountability(accountability);

	if (name === getDefaultConnectionName()) {
		return getDatabase();
	}

	const existing = namedDatabases.get(name);

	if (existing) {
		return existing;
	}

	const { priority: _priority, ...override } = getConfigFromEnv(
		`DB_CONNECTION_${name.toUpperCase()}_`,
	);

	const db = constructDatabase(merge({}, getBaseDbConfig(), override));

	namedDatabases.set(name, db);
	return db;
}
