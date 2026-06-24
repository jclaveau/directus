import path from "path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import knex from "knex";

//#region src/cli/utils/create-db-connection.ts
const __dirname = dirname(fileURLToPath(import.meta.url));
function createDBConnection(client, credentials) {
	let connection = {};
	if (client === "sqlite3") {
		const { filename } = credentials;
		connection = { filename };
	} else {
		const { host, port, database, user, password } = credentials;
		connection = {
			host,
			port: Number(port),
			database,
			user,
			password
		};
		if (client === "pg" || client === "cockroachdb") {
			const { ssl } = credentials;
			connection.ssl = ssl;
		}
		if (client === "mssql") {
			const { options__encrypt } = credentials;
			connection = {
				...connection,
				encrypt: options__encrypt
			};
		}
	}
	const knexConfig = {
		client,
		connection,
		seeds: {
			extension: "js",
			directory: path.resolve(__dirname, "../../database/seeds/")
		},
		pool: {}
	};
	if (client === "sqlite3") knexConfig.useNullAsDefault = true;
	if (client === "cockroachdb") knexConfig.pool.afterCreate = (conn, callback) => {
		conn.query("SET serial_normalization = \"sql_sequence\"");
		conn.query("SET default_int_size = 4");
		callback(null, conn);
	};
	return knex.default(knexConfig);
}

//#endregion
export { createDBConnection as default };