import { useEnv } from '@directus/env';
import type { SchemaInspector } from '@directus/schema';
import { createInspector } from '@directus/schema';
import { isObject } from '@directus/utils';
import type { DatabaseClient } from '@directus/types';
import fse from 'fs-extra';
import type { Knex } from 'knex';
import knex from 'knex';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import path from 'path';
import { performance } from 'perf_hooks';
import { getExtensionsPath } from '../extensions/lib/get-extensions-path.js';
import { useLogger } from '../logger/index.js';
import { useMetrics } from '../metrics/index.js';
import { isArray, merge, toArray } from '../utils/lodash-es-used.js';
import { nodeId } from '../utils/node-id.js';
import { validateEnv } from '../utils/validate-env.js';
import {
	assertConnectionNamesAreUnique,
	assertNamedConnectionsAreComplete,
	connectionFieldEnvKey,
	getBaseConnectionName,
	getBaseDbConfig,
	requiredConnectionFields,
} from './connections.js';
import { getHelpers } from './helpers/index.js';

export {
	getConnectionNameForAccountability,
	getDatabaseForAccountability,
} from './connections.js';

type QueryInfo = Partial<Knex.Sql> & {
	sql: Knex.Sql['sql'];
	__knexUid: string;
	__knexTxId: string;
	[key: string | number | symbol]: any;
};

let database: Knex | null = null;
let inspector: SchemaInspector | null = null;

const __dirname = dirname(fileURLToPath(import.meta.url));

export default getDatabase;

export function getDatabase(): Knex {
	if (database) {
		return database;
	}

	const config = getBaseDbConfig();

	const requiredEnvVars = requiredConnectionFields(config).map(
		(field) => connectionFieldEnvKey('DB_', field),
	);

	validateEnv(requiredEnvVars);
	assertConnectionNamesAreUnique();
	assertNamedConnectionsAreComplete();

	database = constructDatabase(config, getBaseConnectionName());
	return database;
}

/**
 * Build a knex instance from a resolved DB config. Shared by the default pool
 * and named connections so both get the same client-specific pool hooks and
 * query instrumentation.
 *
 * The connection name is what every one of this pool's sessions announces itself
 * as; a pool built without one stays anonymous.
 */
export function constructDatabase(
	config: Record<string, any>,
	connectionName?: string,
): Knex {
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

	// pgbouncer prints this per client and Postgres carries it in
	// `pg_stat_activity`, so a connection can be traced back to the process and
	// the pool it came from. `DB_APPLICATION_NAME` resolves camelCased, which the
	// driver does not read, so a configured name is forwarded under the parameter
	// the driver does read. A connection string carries its own parameters, so
	// only the object form is filled.
	if (
		connectionName !== undefined
		&& connectionString === undefined
		&& (client === 'pg' || client === 'cockroachdb')
	) {
		connectionConfig['application_name'] = connectionConfig['application_name']
			?? connectionConfig['applicationName']
			?? `directus:${nodeId}:${connectionName}`;
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

/**
 * The versions this build ships that the database has not recorded yet.
 *
 * Reading the migration files is fatal: a build without its migrations directory
 * is a broken artifact, and retrying cannot mend it. Reading `directus_migrations`
 * is not — it throws to the caller, so the boot watch can ride out a database that
 * is briefly unreachable while another service is mid-migration.
 */
// eslint-disable-next-line local/no-single-caller-function -- 3 call sites
export async function outstandingMigrations(): Promise<string[]> {
	const logger = useLogger();

	let requiredVersions: (string | undefined)[];

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

		requiredVersions = migrationFiles.map((filePath) => filePath.split('-')[0]);
	}
	catch (error: any) {
		logger.error(`Database migrations cannot be found`);
		logger.error(error);
		throw process.exit(1);
	}

	const completed = await getDatabase()
		.select('version')
		.from('directus_migrations');

	const completedVersions = completed.map(({ version }) => version);

	return requiredVersions.filter((version) => {
		return completedVersions.includes(version) === false;
	}) as string[];
}

/**
 * The outstanding versions under the boot contract: a database that cannot be
 * read at all is fatal here, because nothing is going to retry and nothing
 * should serve. The watch calls `outstandingMigrations` directly instead,
 * precisely so that it can.
 */
// eslint-disable-next-line local/no-single-caller-function -- also called by app.ts
export async function outstandingMigrationsOrExit(): Promise<string[]> {
	const logger = useLogger();

	try {
		return await outstandingMigrations();
	}
	catch (error: any) {
		logger.error(`Can't read the applied migrations from the database`);
		logger.error(error);
		throw process.exit(1);
	}
}

export async function validateMigrations(): Promise<boolean> {
	return (await outstandingMigrationsOrExit()).length === 0;
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
