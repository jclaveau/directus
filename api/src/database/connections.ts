import { useEnv } from '@directus/env';
import type { Accountability } from '@directus/types';
import type { Knex } from 'knex';
import { getConfigFromEnv } from '../utils/get-config-from-env.js';
import { merge } from '../utils/lodash-es-used.js';
import getDatabase, { constructDatabase } from './index.js';

// One knex per named connection, built lazily and memoized for the process
// lifetime — like getDatabase() memoizes the base pool. Keyed by name, not
// config: a name maps to one config per run (env is immutable in prod; bb tests
// must not reuse a name with a different config).
const namedDatabases = new Map<string, Knex>();

/**
 * Name of the base pool (`DB_BASE_CONNECTION_NAME`); policies may grant it too.
 */
export function getBaseConnectionName(): string {
	const name = useEnv()['DB_BASE_CONNECTION_NAME'];

	return typeof name === 'string'
		? name
		: 'base';
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
			'DB_BASE_CONNECTION',
			...connectionPrefixes,
		],
		omitKey: [
			'DB_BATCH_INSERT_CHUNK_SIZE',
			'DB_MSSQL_TRUST_BATCH_RETURNING',
			'DB_CONNECTIONS',
			'DB_PUBLIC_SHARE_CONNECTION_NAME',
		],
	});
}

/**
 * Priority of a connection (`_PRIORITY` env); higher wins. Base pool has its
 * own knob.
 */
export function getConnectionPriority(name: string): number {
	const key =
		name === getBaseConnectionName()
			? 'DB_BASE_CONNECTION_PRIORITY'
			: `DB_CONNECTION_${name.toUpperCase()}_PRIORITY`;

	const priority = useEnv()[key];

	return typeof priority === 'number'
		? priority
		: 0;
}

/** Connection names must be unique (base + `DB_CONNECTIONS`); else boot fails. */
export function assertConnectionNamesAreUnique(): void {
	const seen = new Set([getBaseConnectionName()]);

	for (const name of getExtraConnectionNames()) {
		if (seen.has(name)) {
			throw new Error(
				`Duplicate DB connection name "${name}" — names must be unique`,
			);
		}

		seen.add(name);
	}
}

// Config property → its env-var suffix, so one dialect switch can serve both
// the base pool (validateEnv on `DB_<SUFFIX>`) and a named connection
// (`DB_CONNECTION_<NAME>_<SUFFIX>` / inherited).
const CONNECTION_FIELD_ENV_SUFFIX: Record<string, string> = {
	client: 'CLIENT',
	filename: 'FILENAME',
	host: 'HOST',
	port: 'PORT',
	database: 'DATABASE',
	user: 'USER',
	password: 'PASSWORD',
	connectString: 'CONNECT_STRING',
	connectionString: 'CONNECTION_STRING',
	socketPath: 'SOCKET_PATH',
};

/**
 * The env key of a connection field under a prefix, e.g.
 * (`DB_`, 'connectString') → `DB_CONNECT_STRING`.
 */
export function connectionFieldEnvKey(prefix: string, field: string): string {
	return `${prefix}${CONNECTION_FIELD_ENV_SUFFIX[field]}`;
}

/**
 * The config properties a resolved knex config must carry for its client — the
 * single source of truth for both the base pool's boot validation and a named
 * connection's completeness check. Reads only from the config, so an inherited
 * base field counts the same as an own override.
 */
export function requiredConnectionFields(config: Record<string, any>): string[] {
	const fields = ['client'];

	const {
		client,
		connectionString,
		connectString,
		socketPath,
		type,
	} = config;

	switch (client) {
		case 'sqlite3':
			fields.push('filename');
			break;

		case 'oracledb':
			if (connectString) {
				fields.push('user', 'password', 'connectString');
			}
			else {
				fields.push('host', 'port', 'database', 'user', 'password');
			}

			break;

		case 'cockroachdb':
		case 'pg':
			if (connectionString) {
				fields.push('connectionString');
			}
			else {
				fields.push('host', 'port', 'database', 'user');
			}

			break;

		case 'mysql':
			if (socketPath) {
				fields.push('database', 'user', 'password', 'socketPath');
			}
			else {
				fields.push('host', 'port', 'database', 'user', 'password');
			}

			break;

		case 'mssql':
			if (!type || type === 'default') {
				fields.push('host', 'port', 'database', 'user', 'password');
			}

			break;

		default:
			fields.push('host', 'port', 'database', 'user', 'password');
	}

	return fields;
}

/**
 * A named connection's knex config: its `DB_CONNECTION_<NAME>_*` overrides
 * merged over the base `DB_*` config (priority stripped).
 */
function resolveNamedConnectionConfig(name: string): Record<string, any> {
	const { priority: _priority, ...override } = getConfigFromEnv(
		`DB_CONNECTION_${name.toUpperCase()}_`,
	);

	return merge({}, getBaseDbConfig(), override);
}

/**
 * The knex config any configured connection resolves to, base included, so a
 * caller that only needs to know where a connection points (which host, which
 * database) reads the same answer the pool itself was built from.
 */
export function resolveConnectionConfig(name: string): Record<string, any> {
	return name === getBaseConnectionName()
		? getBaseDbConfig()
		: resolveNamedConnectionConfig(name);
}

/**
 * A named connection's merged config must carry every field its client needs —
 * an inherited base field counts. Throws a pointed error (which env var to set)
 * instead of letting knex fail lazily with a cryptic driver error.
 */
export function assertConnectionConfigComplete(
	name: string,
	config: Record<string, any>,
): void {
	const prefix = `DB_CONNECTION_${name.toUpperCase()}_`;

	for (const field of requiredConnectionFields(config)) {
		if (config[field] === undefined || config[field] === '') {
			throw new Error(
				`DB connection "${name}" is missing "${field}" (client `
				+ `"${config['client']}") — set `
				+ `${connectionFieldEnvKey(prefix, field)} or inherit it from DB_*`,
			);
		}
	}
}

/**
 * Every configured named connection must resolve to a complete config once
 * merged over the base — fail boot, not lazily on the first routed query.
 */
export function assertNamedConnectionsAreComplete(): void {
	for (const name of getExtraConnectionNames()) {
		assertConnectionConfigComplete(name, resolveNamedConnectionConfig(name));
	}
}

/**
 * Resolve the connection name a request should use: the highest-priority among
 * the base pool (always a candidate) and the configured connections the user's
 * policies grant. The base pool is the floor — at equal priority any granted
 * connection outranks it, so base is used only when it strictly outranks every
 * grant or is the sole candidate. Ties among grants break by name.
 */
export function getConnectionNameForAccountability(
	accountability?: Accountability | null,
): string {
	const baseName = getBaseConnectionName();
	const extra = getExtraConnectionNames();

	// A public share is anonymous; when a dedicated share pool is configured,
	// route it there so its traffic can't compete with the base pool. Ignored if
	// the name is unset or not a configured connection.
	if (accountability?.share) {
		const shareName = useEnv()['DB_PUBLIC_SHARE_CONNECTION_NAME'];

		if (
			typeof shareName === 'string' &&
			(shareName === baseName || extra.includes(shareName))
		) {
			return shareName;
		}
	}

	const candidateNames = new Set<string>([baseName]);

	for (const name of accountability?.grantedDbConnections ?? []) {
		if (name === baseName || extra.includes(name)) {
			candidateNames.add(name);
		}
	}

	// Base is always a candidate → array never empty; reduce keeps `best` set.
	const best = [...candidateNames]
		.map((name) => {
			return {
				name,
				priority: getConnectionPriority(name),
				isBase: name === baseName,
			};
		})
		.reduce((winner, candidate) => {
			if (candidate.priority !== winner.priority) {
				return candidate.priority > winner.priority
					? candidate
					: winner;
			}

			// Equal priority: the base pool is the floor, so any grant outranks it.
			if (candidate.isBase !== winner.isBase) {
				return winner.isBase
					? candidate
					: winner;
			}

			// Two grants tie: break by name, deterministically.
			return candidate.name.localeCompare(winner.name) < 0
				? candidate
				: winner;
		});

	return best.name;
}

/**
 * The knex a request uses (base name → base pool; named pools build lazily).
 */
export function getDatabaseForAccountability(
	accountability?: Accountability | null,
): Knex {
	const name = getConnectionNameForAccountability(accountability);

	if (name === getBaseConnectionName()) {
		return getDatabase();
	}

	const existing = namedDatabases.get(name);

	if (existing) {
		return existing;
	}

	const config = resolveNamedConnectionConfig(name);

	// Boot already validated every configured name; this guards a name whose
	// config drifted incomplete after boot (e.g. a live env reload).
	assertConnectionConfigComplete(name, config);

	const db = constructDatabase(config, name);

	namedDatabases.set(name, db);
	return db;
}
