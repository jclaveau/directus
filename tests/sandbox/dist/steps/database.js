import "../config.js";
import "../logger.js";
import { merge } from "lodash-es";
import { isObject } from "@directus/utils";
import knex from "knex";

//#region src/steps/database.ts
/**
* Build a Knex connection.
* Connection settings mirror directus setup
*/
function createDatabase(env, logger) {
	const client = env.DB_CLIENT;
	const connection = client === "sqlite3" ? { filename: env.DB_FILENAME } : {
		host: env.DB_HOST,
		port: Number(env.DB_PORT),
		user: env.DB_USER,
		password: env.DB_PASSWORD,
		database: env.DB_DATABASE
	};
	const poolConfig = {};
	const knexConfig = {
		client,
		connection,
		pool: poolConfig,
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
		}
	};
	if (client === "sqlite3") {
		knexConfig.useNullAsDefault = true;
		poolConfig.afterCreate = (conn, callback) => {
			logger.info("Enabling SQLite Foreign Keys support...");
			conn.run("PRAGMA foreign_keys = ON");
			callback(null, conn);
		};
	}
	if (client === "cockroachdb") poolConfig.afterCreate = (conn, callback) => {
		logger.info("Setting CRDB serial_normalization and default_int_size");
		conn.query("SET serial_normalization = \"sql_sequence\"");
		conn.query("SET default_int_size = 4");
		callback(null, conn);
	};
	if (client === "oracledb") poolConfig.afterCreate = (conn, callback) => {
		logger.info("Setting OracleDB NLS_DATE_FORMAT and NLS_TIMESTAMP_FORMAT");
		conn.execute("ALTER SESSION SET NLS_TIMESTAMP_FORMAT = 'YYYY-MM-DD\"T\"HH24:MI:SS.FF3\"Z\"'");
		conn.execute("ALTER SESSION SET NLS_DATE_FORMAT = 'YYYY-MM-DD'");
		callback(null, conn);
	};
	if (client === "mysql") {
		if (isObject(knexConfig.connection)) delete knexConfig.connection["filename"];
		Object.assign(knexConfig, { client: "mysql2" });
	}
	if (client === "mssql") merge(knexConfig, { connection: { options: { useUTC: false } } });
	return knex(knexConfig);
}

//#endregion
export { createDatabase };