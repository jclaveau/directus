import { useEnv } from '@directus/env';
import type { SchemaInspector } from '@directus/schema';
import { createInspector } from '@directus/schema';
import { isObject } from '@directus/utils';
import type { Accountability, DatabaseClient } from '@directus/types';
import fse from 'fs-extra';
import type { Knex } from 'knex';
import knex from 'knex';
import { isArray, merge, toArray } from 'lodash-es';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import path from 'path';
import { performance } from 'perf_hooks';
import { getExtensionsPath } from '../extensions/lib/get-extensions-path.js';
import { useLogger } from '../logger/index.js';
import { useMetrics } from '../metrics/index.js';
import { getConfigFromEnv } from '../utils/get-config-from-env.js';
import { validateEnv } from '../utils/validate-env.js';
import { getHelpers } from './helpers/index.js';

type QueryInfo = Partial<Knex.Sql> & {
	sql: Knex.Sql['sql'];
	__knexUid: string;
	__knexTxId: string;
	[key: string | number | symbol]: any;
};

let database: Knex | null = null;
const namedDatabases = new Map<string, Knex>();
let inspector: SchemaInspector | null = null;

const __dirname = dirname(fileURLToPath(import.meta.url));

export default getDatabase;

/** Name of the default pool (`DB_DEFAULT_CONNECTION_NAME`); policies may grant it too. */
function getDefaultConnectionName(): string {
	return String(useEnv()['DB_DEFAULT_CONNECTION_NAME'] ?? 'default');
}

/** Names of the extra connections from `DB_CONNECTIONS` (array when cast, CSV at runtime). */
function getExtraConnectionNames(): string[] {
	const value = useEnv()['DB_CONNECTIONS'];

	if (Array.isArray(value)) {
		return value.map(String).filter(Boolean);
	}

	if (typeof value === 'string') {
		const names = value.split(',').map((name) => name.trim());
		return names.filter(Boolean);
	}

	return [];
}

/** Base `DB_*` config, with every named-connection namespace stripped off. */
function getBaseDbConfig(): Record<string, any> {
	const connectionPrefixes = getExtraConnectionNames().map(
		(name) => `DB_CONNECTION_${name.toUpperCase()}_`,
	);

	return getConfigFromEnv('DB_', {
		omitPrefix: ['DB_EXCLUDE_TABLES', 'DB_DEFAULT_CONNECTION', ...connectionPrefixes],
		omitKey: [
			'DB_BATCH_INSERT_CHUNK_SIZE',
			'DB_MSSQL_TRUST_BATCH_RETURNING',
			'DB_CONNECTIONS',
		],
	});
}

/** Priority of a connection (`_PRIORITY` env); higher wins. Default pool has its own knob. */
function getConnectionPriority(name: string): number {
	if (name === getDefaultConnectionName()) {
		return Number(useEnv()['DB_DEFAULT_CONNECTION_PRIORITY'] ?? 0) || 0;
	}

	const { priority } = getConfigFromEnv(`DB_CONNECTION_${name.toUpperCase()}_`);
	return Number(priority ?? 0) || 0;
}

/** Connection names must be unique (default + `DB_CONNECTIONS`); else boot fails. */
function assertConnectionNamesAreUnique(): void {
	const seen = new Set([getDefaultConnectionName()]);

	for (const name of getExtraConnectionNames()) {
		if (seen.has(name)) {
			throw new Error(`Duplicate DB connection name "${name}" — names must be unique`);
		}

		seen.add(name);
	}
}

export function getDatabase(): Knex {
	if (database) {
		return database;
	}

	const env = useEnv();

	const config = getBaseDbConfig();
	const { client, connectionString } = config;

	const requiredEnvVars = ['DB_CLIENT'];

	switch (client) {
		case 'sqlite3':
			requiredEnvVars.push('DB_FILENAME');
			break;

		case 'oracledb':
			if (!env['DB_CONNECT_STRING']) {
				requiredEnvVars.push('DB_HOST', 'DB_PORT', 'DB_DATABASE', 'DB_USER', 'DB_PASSWORD');
			} else {
				requiredEnvVars.push('DB_USER', 'DB_PASSWORD', 'DB_CONNECT_STRING');
			}

			break;

		case 'cockroachdb':
		case 'pg':
			if (!connectionString) {
				requiredEnvVars.push('DB_HOST', 'DB_PORT', 'DB_DATABASE', 'DB_USER');
			} else {
				requiredEnvVars.push('DB_CONNECTION_STRING');
			}

			break;
		case 'mysql':
			if (!env['DB_SOCKET_PATH']) {
				requiredEnvVars.push('DB_HOST', 'DB_PORT', 'DB_DATABASE', 'DB_USER', 'DB_PASSWORD');
			} else {
				requiredEnvVars.push('DB_DATABASE', 'DB_USER', 'DB_PASSWORD', 'DB_SOCKET_PATH');
			}

			break;
		case 'mssql':
			if (!env['DB_TYPE'] || env['DB_TYPE'] === 'default') {
				requiredEnvVars.push('DB_HOST', 'DB_PORT', 'DB_DATABASE', 'DB_USER', 'DB_PASSWORD');
			}

			break;
		default:
			requiredEnvVars.push('DB_HOST', 'DB_PORT', 'DB_DATABASE', 'DB_USER', 'DB_PASSWORD');
	}

	validateEnv(requiredEnvVars);
	assertConnectionNamesAreUnique();

	database = constructDatabase(config);
	return database;
}

/**
 * Build a knex instance from a resolved DB config. Shared by the default pool and named
 * connections so both get the same client-specific pool hooks and query instrumentation.
 */
function constructDatabase(config: Record<string, any>): Knex {
	const logger = useLogger();
	const metrics = useMetrics();

	const {
		client,
		version,
		searchPath,
		connectionString,
		pool: poolConfig = {},
		...connectionConfig
	} = config;

	// Pool sizes/timeouts arrive as strings at runtime (env-inject) or unmapped in env;
	// tarn wants numbers, so coerce the numeric knobs before knex sees them.
	const numericPoolKeys = [
		'min',
		'max',
		'acquireTimeoutMillis',
		'createTimeoutMillis',
		'idleTimeoutMillis',
	];

	for (const key of numericPoolKeys) {
		if (poolConfig[key] !== undefined) {
			poolConfig[key] = Number(poolConfig[key]);
		}
	}

	const knexConfig: Knex.Config = {
		client,
		version,
		searchPath,
		connection: connectionString || connectionConfig,
		log: {
			warn: (msg) => {
				// Ignore warnings about returning not being supported in some DBs
				if (msg.startsWith('.returning()')) return;
				if (msg.endsWith('does not currently support RETURNING clause')) return;

				// Ignore warning about MySQL not supporting TRX for DDL
				if (msg.startsWith('Transaction was implicitly committed, do not mix transactions and DDL with MySQL')) return;

				return logger.warn(msg);
			},
			error: (msg) => logger.error(msg),
			deprecate: (msg) => logger.info(msg),
			debug: (msg) => logger.debug(msg),
		},
		pool: poolConfig,
	};

	if (client === 'sqlite3') {
		knexConfig.useNullAsDefault = true;

		poolConfig.afterCreate = (conn: any, callback: any) => {
			logger.trace('Enabling SQLite Foreign Keys support...');

			conn.run('PRAGMA foreign_keys = ON');

			callback(null, conn);
		};
	}

	if (client === 'cockroachdb') {
		poolConfig.afterCreate = (conn: any, callback: any) => {
			logger.trace('Setting CRDB serial_normalization and default_int_size');

			conn.query('SET serial_normalization = "sql_sequence"');
			conn.query('SET default_int_size = 4');

			callback(null, conn);
		};
	}

	if (client === 'oracledb') {
		poolConfig.afterCreate = (conn: any, callback: any) => {
			logger.trace('Setting OracleDB NLS_DATE_FORMAT and NLS_TIMESTAMP_FORMAT');

			// enforce proper ISO standard 2024-12-10T10:54:00.123Z for datetime/timestamp
			conn.execute('ALTER SESSION SET NLS_TIMESTAMP_FORMAT = \'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"\'');

			// enforce 2024-12-10 date formet
			conn.execute("ALTER SESSION SET NLS_DATE_FORMAT = 'YYYY-MM-DD'");

			callback(null, conn);
		};
	}

	if (client === 'mysql') {
		// Remove the conflicting `filename` option, defined by default in the Docker Image
		if (isObject(knexConfig.connection)) delete knexConfig.connection['filename'];

		Object.assign(knexConfig, { client: 'mysql2' });
	}

	if (client === 'mssql') {
		// This brings MS SQL in line with the other DB vendors. We shouldn't do any automatic
		// timezone conversion on the database level, especially not when other database vendors don't
		// act the same
		merge(knexConfig, { connection: { options: { useUTC: false } } });
	}

	const dbInstance = knex.default(knexConfig);
	validateDatabaseCharset(dbInstance);

	const times = new Map<string, number>();

	dbInstance
		.on('query', ({ __knexUid }: QueryInfo) => {
			times.set(__knexUid, performance.now());
		})
		.on('query-response', (_response, queryInfo: QueryInfo) => {
			const time = times.get(queryInfo.__knexUid);
			let delta;

			if (time) {
				delta = performance.now() - time;
				times.delete(queryInfo.__knexUid);

				metrics?.getDatabaseResponseMetric()?.observe(delta);
			}

			// eslint-disable-next-line no-nested-ternary
			const bindings = queryInfo.bindings
				? isArray(queryInfo.bindings)
					? queryInfo.bindings
					: Object.values(queryInfo.bindings)
				: [];

			logger.trace(`[${delta ? delta.toFixed(3) : '?'}ms] ${queryInfo.sql} [${bindings.join(', ')}]`);
		})
		.on('query-error', (_, queryInfo: QueryInfo) => {
			times.delete(queryInfo.__knexUid);
		});

	return dbInstance;
}

/** Lazily build (and cache) a named connection; the default name → base pool. */
function getNamedDatabase(name: string): Knex {
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

/**
 * Resolve the connection name a request should use: the highest-priority among the
 * default pool (always a candidate) and the configured connections the user's policies
 * grant. Ties break by name, so a winner must outrank `DB_DEFAULT_CONNECTION_PRIORITY`.
 */
function resolveConnectionName(accountability?: Accountability | null): string {
	const defaultName = getDefaultConnectionName();
	const extra = getExtraConnectionNames();

	// The default pool always competes; add every granted connection that is configured
	const candidateNames = new Set<string>([defaultName]);

	for (const name of accountability?.dbConnections ?? []) {
		if (name === defaultName || extra.includes(name)) {
			candidateNames.add(name);
		}
	}

	// Default is always a candidate → array never empty; reduce keeps `best` set.
	const best = [...candidateNames]
		.map((name) => ({ name, priority: getConnectionPriority(name) }))
		.reduce((winner, candidate) => {
			const samePriority = candidate.priority === winner.priority;

			const winsByName = samePriority && candidate.name.localeCompare(winner.name) < 0;

			return candidate.priority > winner.priority || winsByName
				? candidate
				: winner;
		});

	return best.name;
}

/** The knex a request routes to (default name → base pool; named pools build lazily). */
export function getDatabaseForAccountability(
	accountability?: Accountability | null,
): Knex {
	return getNamedDatabase(resolveConnectionName(accountability));
}

/** Name of the connection a request routes to (tags pool errors with the tier). */
export function getConnectionNameForAccountability(
	accountability?: Accountability | null,
): string {
	return resolveConnectionName(accountability);
}

export function getSchemaInspector(database?: Knex): SchemaInspector {
	if (inspector) {
		return inspector;
	}

	database ??= getDatabase();

	inspector = createInspector(database);

	return inspector;
}

export async function hasDatabaseConnection(database?: Knex): Promise<boolean> {
	database = database ?? getDatabase();

	try {
		if (getDatabaseClient(database) === 'oracle') {
			await database.raw('select 1 from DUAL');
		} else {
			await database.raw('SELECT 1');
		}

		return true;
	} catch {
		return false;
	}
}

export async function validateDatabaseConnection(database?: Knex): Promise<void> {
	database = database ?? getDatabase();
	const logger = useLogger();

	try {
		if (getDatabaseClient(database) === 'oracle') {
			await database.raw('select 1 from DUAL');
		} else {
			await database.raw('SELECT 1');
		}
	} catch (error: any) {
		logger.error(`Can't connect to the database.`);
		logger.error(error);
		process.exit(1);
	}
}

export function getDatabaseClient(database?: Knex): DatabaseClient {
	database = database ?? getDatabase();

	switch (database.client.constructor.name) {
		case 'Client_MySQL2':
			return 'mysql';
		case 'Client_PG':
			return 'postgres';
		case 'Client_CockroachDB':
			return 'cockroachdb';
		case 'Client_SQLite3':
			return 'sqlite';
		case 'Client_Oracledb':
		case 'Client_Oracle':
			return 'oracle';
		case 'Client_MSSQL':
			return 'mssql';
		case 'Client_Redshift':
			return 'redshift';
	}

	throw new Error(`Couldn't extract database client`);
}

export async function isInstalled(): Promise<boolean> {
	const inspector = getSchemaInspector();

	// The existence of a directus_collections table alone isn't a "proper" check to see if everything
	// is installed correctly of course, but it's safe enough to assume that this collection only
	// exists when Directus is properly installed.
	return await inspector.hasTable('directus_collections');
}

export async function validateMigrations(): Promise<boolean> {
	const database = getDatabase();
	const logger = useLogger();

	try {
		let migrationFiles = await fse.readdir(path.join(__dirname, 'migrations'));

		const customMigrationsPath = path.resolve(getExtensionsPath(), 'migrations');

		let customMigrationFiles =
			((await fse.pathExists(customMigrationsPath)) && (await fse.readdir(customMigrationsPath))) || [];

		migrationFiles = migrationFiles.filter(
			(file: string) => file.startsWith('run') === false && file.endsWith('.d.ts') === false,
		);

		customMigrationFiles = customMigrationFiles.filter((file: string) => file.endsWith('.js'));

		migrationFiles.push(...customMigrationFiles);

		const requiredVersions = migrationFiles.map((filePath) => filePath.split('-')[0]);

		const completedVersions = (await database.select('version').from('directus_migrations')).map(
			({ version }) => version,
		);

		return requiredVersions.every((version) => completedVersions.includes(version));
	} catch (error: any) {
		logger.error(`Database migrations cannot be found`);
		logger.error(error);
		throw process.exit(1);
	}
}

/**
 * These database extensions should be optional, so we don't throw or return any problem states when they don't
 */
export async function validateDatabaseExtensions(): Promise<void> {
	const database = getDatabase();
	const client = getDatabaseClient(database);
	const helpers = getHelpers(database);
	const geometrySupport = await helpers.st.supported();
	const logger = useLogger();

	if (!geometrySupport) {
		switch (client) {
			case 'postgres':
				logger.warn(`PostGIS isn't installed. Geometry type support will be limited.`);
				break;
			case 'sqlite':
				logger.warn(`Spatialite isn't installed. Geometry type support will be limited.`);
				break;
			default:
				logger.warn(`Geometry type not supported on ${client}`);
		}
	}
}

async function validateDatabaseCharset(database?: Knex): Promise<void> {
	const env = useEnv();
	database = database ?? getDatabase();
	const logger = useLogger();

	if (getDatabaseClient(database) === 'mysql') {
		const helpers = getHelpers(database);
		const { collation } = await database.select(database.raw(`@@collation_database as collation`)).first();

		const tables = await database('information_schema.tables')
			.select({ name: 'TABLE_NAME', collation: 'TABLE_COLLATION' })
			.where({ TABLE_SCHEMA: env['DB_DATABASE'] });

		const columns = await helpers.schema.getColumnsWithInvalidCollation(env['DB_DATABASE'] as string, collation);

		const excludedTables: string[] = toArray(env['DB_EXCLUDE_TABLES']);

		let inconsistencies = '';

		for (const table of tables) {
			if (excludedTables.includes(table.name)) continue;

			const tableColumns = columns.filter((column) => column.table_name === table.name);
			const tableHasInvalidCollation = table.collation !== collation;

			if (tableHasInvalidCollation || tableColumns.length > 0) {
				inconsistencies += `\t\t- Table "${table.name}": "${table.collation}"\n`;

				for (const column of tableColumns) {
					inconsistencies += `\t\t  - Column "${column.name}": "${column.collation}"\n`;
				}
			}
		}

		if (inconsistencies) {
			logger.warn(
				`Some tables and columns do not match your database's default collation (${collation}):\n${inconsistencies}`,
			);
		}
	}

	return;
}
