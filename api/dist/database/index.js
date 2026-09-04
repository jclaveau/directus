import { nodeId } from "../utils/node-id.js";
import { useLogger } from "../logger/index.js";
import { getExtensionsPath } from "../extensions/lib/get-extensions-path.js";
import { validateEnv } from "../utils/validate-env.js";
import { useMetrics } from "../metrics/lib/use-metrics.js";
import "../metrics/index.js";
import { assertConnectionNamesAreUnique, assertNamedConnectionsAreComplete, connectionFieldEnvKey, getBaseConnectionName, getBaseDbConfig, getConnectionNameForAccountability, getDatabaseForAccountability, requiredConnectionFields } from "./connections.js";
import { getHelpers } from "./helpers/index.js";
import { useEnv } from "@directus/env";
import { isArray, merge, toArray } from "lodash-es";
import path from "path";
import { isObject as isObject$1 } from "@directus/utils";
import { performance } from "perf_hooks";
import { fileURLToPath } from "node:url";
import { createInspector } from "@directus/schema";
import fse from "fs-extra";
import knex from "knex";
import { dirname } from "node:path";

//#region src/database/index.ts
let database = null;
let inspector = null;
const __dirname = dirname(fileURLToPath(import.meta.url));
var database_default = getDatabase;
function getDatabase() {
	if (database) return database;
	const config = getBaseDbConfig();
	validateEnv(requiredConnectionFields(config).map((field) => connectionFieldEnvKey("DB_", field)));
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
function constructDatabase(config, connectionName) {
	const logger = useLogger();
	const metrics = useMetrics();
	const { client, version, searchPath, connectionString, pool: poolConfig = {},...connectionConfig } = config;
	if (connectionName !== void 0 && connectionString === void 0 && (client === "pg" || client === "cockroachdb")) connectionConfig["application_name"] = connectionConfig["application_name"] ?? connectionConfig["applicationName"] ?? `directus:${nodeId}:${connectionName}`;
	const knexConfig = {
		client,
		version,
		searchPath,
		connection: connectionString || connectionConfig,
		log: {
			warn: (msg) => {
				if (msg.startsWith(".returning()")) return;
				if (msg.endsWith("does not currently support RETURNING clause")) return;
				if (msg.startsWith("Transaction was implicitly committed, do not mix transactions and DDL with MySQL")) return;
				return logger.warn(msg);
			},
			error: (msg) => logger.error(msg),
			deprecate: (msg) => logger.info(msg),
			debug: (msg) => logger.debug(msg)
		},
		pool: poolConfig
	};
	if (client === "sqlite3") {
		knexConfig.useNullAsDefault = true;
		poolConfig.afterCreate = (conn, callback) => {
			logger.trace("Enabling SQLite Foreign Keys support...");
			conn.run("PRAGMA foreign_keys = ON");
			callback(null, conn);
		};
	}
	if (client === "cockroachdb") poolConfig.afterCreate = (conn, callback) => {
		logger.trace("Setting CRDB serial_normalization and default_int_size");
		conn.query("SET serial_normalization = \"sql_sequence\"");
		conn.query("SET default_int_size = 4");
		callback(null, conn);
	};
	if (client === "oracledb") poolConfig.afterCreate = (conn, callback) => {
		logger.trace("Setting OracleDB NLS_DATE_FORMAT and NLS_TIMESTAMP_FORMAT");
		conn.execute("ALTER SESSION SET NLS_TIMESTAMP_FORMAT = 'YYYY-MM-DD\"T\"HH24:MI:SS.FF3\"Z\"'");
		conn.execute("ALTER SESSION SET NLS_DATE_FORMAT = 'YYYY-MM-DD'");
		callback(null, conn);
	};
	if (client === "mysql") {
		if (isObject$1(knexConfig.connection)) delete knexConfig.connection["filename"];
		Object.assign(knexConfig, { client: "mysql2" });
	}
	if (client === "mssql") merge(knexConfig, { connection: { options: { useUTC: false } } });
	const dbInstance = knex.default(knexConfig);
	validateDatabaseCharset(dbInstance);
	const times = /* @__PURE__ */ new Map();
	dbInstance.on("query", ({ __knexUid }) => {
		times.set(__knexUid, performance.now());
	}).on("query-response", (_response, queryInfo) => {
		const time = times.get(queryInfo.__knexUid);
		let delta;
		if (time) {
			delta = performance.now() - time;
			times.delete(queryInfo.__knexUid);
			metrics?.getDatabaseResponseMetric()?.observe(delta);
		}
		const bindings = queryInfo.bindings ? isArray(queryInfo.bindings) ? queryInfo.bindings : Object.values(queryInfo.bindings) : [];
		logger.trace(`[${delta ? delta.toFixed(3) : "?"}ms] ${queryInfo.sql} [${bindings.join(", ")}]`);
	}).on("query-error", (_, queryInfo) => {
		times.delete(queryInfo.__knexUid);
	});
	return dbInstance;
}
function getSchemaInspector(database$1) {
	if (inspector) return inspector;
	database$1 ??= getDatabase();
	inspector = createInspector(database$1);
	return inspector;
}
async function hasDatabaseConnection(database$1) {
	database$1 = database$1 ?? getDatabase();
	try {
		if (getDatabaseClient(database$1) === "oracle") await database$1.raw("select 1 from DUAL");
		else await database$1.raw("SELECT 1");
		return true;
	} catch {
		return false;
	}
}
async function validateDatabaseConnection(database$1) {
	database$1 = database$1 ?? getDatabase();
	const logger = useLogger();
	try {
		if (getDatabaseClient(database$1) === "oracle") await database$1.raw("select 1 from DUAL");
		else await database$1.raw("SELECT 1");
	} catch (error) {
		logger.error(`Can't connect to the database.`);
		logger.error(error);
		process.exit(1);
	}
}
function getDatabaseClient(database$1) {
	database$1 = database$1 ?? getDatabase();
	switch (database$1.client.constructor.name) {
		case "Client_MySQL2": return "mysql";
		case "Client_PG": return "postgres";
		case "Client_CockroachDB": return "cockroachdb";
		case "Client_SQLite3": return "sqlite";
		case "Client_Oracledb":
		case "Client_Oracle": return "oracle";
		case "Client_MSSQL": return "mssql";
		case "Client_Redshift": return "redshift";
	}
	throw new Error(`Couldn't extract database client`);
}
async function isInstalled() {
	return await getSchemaInspector().hasTable("directus_collections");
}
/**
* The versions this build ships that the database has not recorded yet.
*
* Reading the migration files is fatal: a build without its migrations directory
* is a broken artifact, and retrying cannot mend it. Reading `directus_migrations`
* is not — it throws to the caller, so the boot watch can ride out a database that
* is briefly unreachable while another service is mid-migration.
*/
async function outstandingMigrations() {
	const logger = useLogger();
	let requiredVersions;
	try {
		let migrationFiles = await fse.readdir(path.join(__dirname, "migrations"));
		const customMigrationsPath = path.resolve(getExtensionsPath(), "migrations");
		let customMigrationFiles = await fse.pathExists(customMigrationsPath) && await fse.readdir(customMigrationsPath) || [];
		migrationFiles = migrationFiles.filter((file) => file.startsWith("run") === false && file.endsWith(".d.ts") === false);
		customMigrationFiles = customMigrationFiles.filter((file) => file.endsWith(".js"));
		migrationFiles.push(...customMigrationFiles);
		requiredVersions = migrationFiles.map((filePath) => filePath.split("-")[0]);
	} catch (error) {
		logger.error(`Database migrations cannot be found`);
		logger.error(error);
		throw process.exit(1);
	}
	const completedVersions = (await getDatabase().select("version").from("directus_migrations")).map(({ version }) => version);
	return requiredVersions.filter((version) => {
		return completedVersions.includes(version) === false;
	});
}
/**
* The outstanding versions under the boot contract: a database that cannot be
* read at all is fatal here, because nothing is going to retry and nothing
* should serve. The watch calls `outstandingMigrations` directly instead,
* precisely so that it can.
*/
async function outstandingMigrationsOrExit() {
	const logger = useLogger();
	try {
		return await outstandingMigrations();
	} catch (error) {
		logger.error(`Can't read the applied migrations from the database`);
		logger.error(error);
		throw process.exit(1);
	}
}
async function validateMigrations() {
	return (await outstandingMigrationsOrExit()).length === 0;
}
/**
* These database extensions should be optional, so we don't throw or return any problem states when they don't
*/
async function validateDatabaseExtensions() {
	const database$1 = getDatabase();
	const client = getDatabaseClient(database$1);
	const geometrySupport = await getHelpers(database$1).st.supported();
	const logger = useLogger();
	if (!geometrySupport) switch (client) {
		case "postgres":
			logger.warn(`PostGIS isn't installed. Geometry type support will be limited.`);
			break;
		case "sqlite":
			logger.warn(`Spatialite isn't installed. Geometry type support will be limited.`);
			break;
		default: logger.warn(`Geometry type not supported on ${client}`);
	}
}
async function validateDatabaseCharset(database$1) {
	const env = useEnv();
	database$1 = database$1 ?? getDatabase();
	const logger = useLogger();
	if (getDatabaseClient(database$1) === "mysql") {
		const helpers = getHelpers(database$1);
		const { collation } = await database$1.select(database$1.raw(`@@collation_database as collation`)).first();
		const tables = await database$1("information_schema.tables").select({
			name: "TABLE_NAME",
			collation: "TABLE_COLLATION"
		}).where({ TABLE_SCHEMA: env["DB_DATABASE"] });
		const columns = await helpers.schema.getColumnsWithInvalidCollation(env["DB_DATABASE"], collation);
		const excludedTables = toArray(env["DB_EXCLUDE_TABLES"]);
		let inconsistencies = "";
		for (const table of tables) {
			if (excludedTables.includes(table.name)) continue;
			const tableColumns = columns.filter((column) => column.table_name === table.name);
			if (table.collation !== collation || tableColumns.length > 0) {
				inconsistencies += `\t\t- Table "${table.name}": "${table.collation}"\n`;
				for (const column of tableColumns) inconsistencies += `\t\t  - Column "${column.name}": "${column.collation}"\n`;
			}
		}
		if (inconsistencies) logger.warn(`Some tables and columns do not match your database's default collation (${collation}):\n${inconsistencies}`);
	}
}

//#endregion
export { constructDatabase, database_default as default, getConnectionNameForAccountability, getDatabase, getDatabaseClient, getDatabaseForAccountability, getSchemaInspector, hasDatabaseConnection, isInstalled, outstandingMigrations, outstandingMigrationsOrExit, validateDatabaseConnection, validateDatabaseExtensions, validateMigrations };