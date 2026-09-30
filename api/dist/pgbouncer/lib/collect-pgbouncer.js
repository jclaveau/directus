import { resolvePgBouncerEndpoints } from "./pgbouncer-config.js";
import { showPgBouncer } from "./admin-console.js";

//#region src/pgbouncer/lib/collect-pgbouncer.ts
/**
* The settings that explain a queueing pool, and nothing else — `SHOW CONFIG`
* answers ninety-odd rows, of which these are the ones a saturation reading is
* argued from.
*/
const PGBOUNCER_LIMIT_KEYS = [
	"pool_mode",
	"default_pool_size",
	"min_pool_size",
	"reserve_pool_size",
	"max_client_conn",
	"max_db_connections",
	"max_user_connections",
	"query_wait_timeout",
	"server_idle_timeout",
	"server_lifetime"
];
/** The admin console's own pool, which says nothing about the fronted database. */
const ADMIN_DATABASE = "pgbouncer";
function text(value) {
	return value === null || value === void 0 ? "" : String(value);
}
function count(value) {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
}
/** pgbouncer splits a duration into whole seconds and their microsecond part. */
function durationMs(seconds, microseconds) {
	return count(seconds) * 1e3 + count(microseconds) / 1e3;
}
function flag(value) {
	return count(value) === 1;
}
/** A size of zero means the database inherits the global default, not "none". */
function sizeOrInherited(value) {
	const size = count(value);
	return size === 0 ? null : size;
}
function isFronted(row) {
	return text(row["database"]) !== ADMIN_DATABASE;
}
/**
* `SHOW DATABASES` names the pool under `name` and keeps `database` for the
* server-side database it forwards to, so the two commands have to be filtered
* on different columns to drop the same admin entry.
*/
function isFrontedDatabase(row) {
	return text(row["name"]) !== ADMIN_DATABASE;
}
/**
* The pools of one instance. `SHOW POOLS` lists a database only once it has been
* used, so `SHOW DATABASES` — which lists every configured one — is the spine: a
* tier that has taken no traffic yet is shown idle rather than omitted, which is
* the difference between "not used" and "not configured".
*/
function buildPools(endpoint, poolRows, databaseRows) {
	const configured = databaseRows.filter(isFrontedDatabase);
	const used = poolRows.filter(isFronted);
	const connectionsOf = (database) => {
		return endpoint.connections.filter((connection) => connection.database === database).map((connection) => connection.name);
	};
	const pools = used.map((row) => {
		const database = text(row["database"]);
		const definition = configured.find((entry) => {
			return text(entry["name"]) === database;
		});
		return {
			database,
			user: text(row["user"]),
			poolMode: text(row["pool_mode"]) || text(definition?.["pool_mode"]) || null,
			clientsActive: count(row["cl_active"]),
			clientsWaiting: count(row["cl_waiting"]),
			serversActive: count(row["sv_active"]),
			serversIdle: count(row["sv_idle"]),
			serversUsed: count(row["sv_used"]),
			serversLogin: count(row["sv_login"]),
			maxWaitMs: durationMs(row["maxwait"], row["maxwait_us"]),
			poolSize: sizeOrInherited(definition?.["pool_size"]),
			reservePoolSize: sizeOrInherited(definition?.["reserve_pool_size"]),
			paused: flag(definition?.["paused"]),
			disabled: flag(definition?.["disabled"]),
			connections: connectionsOf(database)
		};
	});
	for (const definition of configured) {
		const database = text(definition["name"]);
		if (pools.some((pool) => pool.database === database)) continue;
		pools.push({
			database,
			user: text(definition["force_user"]),
			poolMode: text(definition["pool_mode"]) || null,
			clientsActive: 0,
			clientsWaiting: 0,
			serversActive: 0,
			serversIdle: 0,
			serversUsed: 0,
			serversLogin: 0,
			maxWaitMs: 0,
			poolSize: sizeOrInherited(definition["pool_size"]),
			reservePoolSize: sizeOrInherited(definition["reserve_pool_size"]),
			paused: flag(definition["paused"]),
			disabled: flag(definition["disabled"]),
			connections: connectionsOf(database)
		});
	}
	return pools.sort((one, other) => {
		return one.database.localeCompare(other.database);
	});
}
function buildClients(rows) {
	return rows.filter(isFronted).map((row) => {
		return {
			database: text(row["database"]),
			user: text(row["user"]),
			state: text(row["state"]),
			addr: text(row["addr"]),
			port: count(row["port"]),
			applicationName: text(row["application_name"]),
			waitMs: durationMs(row["wait"], row["wait_us"]),
			connectedAt: text(row["connect_time"]),
			tls: text(row["tls"]),
			linked: text(row["link"]) !== ""
		};
	});
}
function buildServers(rows) {
	return rows.filter(isFronted).map((row) => {
		const remotePid = count(row["remote_pid"]);
		return {
			database: text(row["database"]),
			user: text(row["user"]),
			state: text(row["state"]),
			addr: text(row["addr"]),
			port: count(row["port"]),
			connectedAt: text(row["connect_time"]),
			tls: text(row["tls"]),
			remotePid: remotePid === 0 ? null : remotePid
		};
	});
}
function buildStats(rows) {
	return rows.filter(isFronted).map((row) => {
		return {
			database: text(row["database"]),
			totalXactCount: count(row["total_xact_count"]),
			totalQueryCount: count(row["total_query_count"]),
			totalReceivedBytes: count(row["total_received"]),
			totalSentBytes: count(row["total_sent"]),
			totalWaitTimeUs: count(row["total_wait_time"]),
			avgXactCount: count(row["avg_xact_count"]),
			avgQueryCount: count(row["avg_query_count"]),
			avgQueryTimeUs: count(row["avg_query_time"]),
			avgWaitTimeUs: count(row["avg_wait_time"])
		};
	});
}
function buildLimits(rows) {
	const byKey = new Map(rows.map((row) => [text(row["key"]), row]));
	return PGBOUNCER_LIMIT_KEYS.flatMap((key) => {
		const row = byKey.get(key);
		if (row === void 0) return [];
		const value = text(row["value"]);
		const fallback = text(row["default"]);
		return [{
			key,
			value,
			default: fallback,
			isDefault: value === fallback
		}];
	});
}
async function readInstance(endpoint, details) {
	const instance = {
		id: endpoint.id,
		host: endpoint.host,
		port: endpoint.port,
		connections: endpoint.connections.map((connection) => connection.name),
		reachable: false,
		error: null,
		version: null,
		pools: [],
		clients: [],
		servers: [],
		stats: [],
		limits: []
	};
	try {
		const version = await showPgBouncer(endpoint, "SHOW VERSION");
		instance.reachable = true;
		instance.version = text(version[0]?.["version"]) || null;
		if (details.includes("pools")) instance.pools = buildPools(endpoint, await showPgBouncer(endpoint, "SHOW POOLS"), await showPgBouncer(endpoint, "SHOW DATABASES"));
		if (details.includes("stats")) instance.stats = buildStats(await showPgBouncer(endpoint, "SHOW STATS"));
		if (details.includes("limits")) instance.limits = buildLimits(await showPgBouncer(endpoint, "SHOW CONFIG"));
		if (details.includes("clients")) instance.clients = buildClients(await showPgBouncer(endpoint, "SHOW CLIENTS"));
		if (details.includes("servers")) instance.servers = buildServers(await showPgBouncer(endpoint, "SHOW SERVERS"));
	} catch (error) {
		instance.reachable = false;
		instance.error = error?.message ?? String(error);
	}
	return instance;
}
/** Read every configured admin console, concurrently — they share nothing. */
async function collectPgBouncer(details) {
	const endpoints = resolvePgBouncerEndpoints();
	const instances = await Promise.all(endpoints.map((endpoint) => readInstance(endpoint, details)));
	return {
		collectedAt: Date.now(),
		details,
		instances
	};
}

//#endregion
export { PGBOUNCER_LIMIT_KEYS, buildClients, buildLimits, buildPools, buildServers, buildStats, collectPgBouncer };