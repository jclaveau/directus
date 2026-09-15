import { useLogger } from "../../logger/index.js";
import { pgbouncerQueryTimeoutMs } from "./pgbouncer-config.js";
import pg from "pg";

//#region src/pgbouncer/lib/admin-console.ts
/**
* pgbouncer's admin console is not Postgres: it answers `SHOW`, and nothing
* else. knex cannot be used for it — its `pg` dialect issues `select version();`
* on every new connection, which the console rejects with
* `invalid command 'select version();', use SHOW HELP;`, so every query on a
* knex-built pool fails. Hence a bare client per endpoint, kept for the process
* lifetime like the named pools are.
*/
const consoles = /* @__PURE__ */ new Map();
function keyOf(endpoint) {
	return `${endpoint.id}/${endpoint.database}/${endpoint.user}`;
}
async function connect(endpoint) {
	const timeout = pgbouncerQueryTimeoutMs();
	const client = new pg.Client({
		host: endpoint.host,
		port: endpoint.port,
		database: endpoint.database,
		user: endpoint.user,
		password: endpoint.password,
		connectionTimeoutMillis: timeout,
		query_timeout: timeout,
		application_name: "directus-pgbouncer-admin"
	});
	client.on("error", (error) => {
		useLogger().trace(error, "[pgbouncer] admin console connection lost");
		consoles.delete(keyOf(endpoint));
	});
	await client.connect();
	return client;
}
/**
* Run one `SHOW` against an endpoint's admin console. A failed query drops the
* client so the next read reconnects rather than reusing a broken session.
*/
async function showPgBouncer(endpoint, command) {
	const key = keyOf(endpoint);
	let client = consoles.get(key);
	if (client === void 0) {
		client = await connect(endpoint);
		consoles.set(key, client);
	}
	try {
		return (await client.query(command)).rows;
	} catch (error) {
		consoles.delete(key);
		await client.end().catch(() => {});
		throw error;
	}
}
/** Close every open console, so a shutdown leaves no session behind. */
async function closePgBouncerConsoles() {
	const open = [...consoles.values()];
	consoles.clear();
	await Promise.all(open.map((client) => client.end().catch(() => {})));
}

//#endregion
export { closePgBouncerConsoles, showPgBouncer };