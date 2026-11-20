import { getMilliseconds } from "../../utils/get-milliseconds.js";
import { getBaseConnectionName, getExtraConnectionNames, resolveConnectionConfig } from "../../database/connections.js";
import { useEnv } from "@directus/env";

//#region src/pgbouncer/lib/pgbouncer-config.ts
/** pgbouncer's own default listen port, used when a host carries none. */
const DEFAULT_ADMIN_PORT = 6432;
/** The virtual database the admin console answers on. */
const DEFAULT_ADMIN_DATABASE = "pgbouncer";
/**
* Whether this node serves the pgbouncer report at all. Off removes the
* endpoint, so a deployment without a pooler has no dead page — the report is
* admin-only either way.
*/
function pgbouncerReportEnabled() {
	return useEnv()["PGBOUNCER_REPORT_ENABLED"] === true;
}
/** The registry connections that reach Postgres through pgbouncer. */
function pgbouncerConnectionNames() {
	const configured = useEnv()["PGBOUNCER_CONNECTIONS"];
	if (Array.isArray(configured) === false) return [];
	return configured.map((name) => String(name).trim()).filter(Boolean);
}
/** How long a single admin query may take before it is given up on. */
function pgbouncerQueryTimeoutMs() {
	return getMilliseconds(useEnv()["PGBOUNCER_QUERY_TIMEOUT"], 2e3);
}
function envKey(connection, suffix) {
	return `PGBOUNCER_${connection.toUpperCase()}_${suffix}`;
}
function stringEnv(connection, suffix) {
	const value = useEnv()[envKey(connection, suffix)];
	return typeof value === "string" && value !== "" ? value : null;
}
/**
* The admin endpoints of one connection. Defaults to the pooler the connection
* itself talks to; an HA fleet sits behind one address and would answer for
* whichever process took the connection, so `_ADMIN_HOSTS` names its members
* explicitly and each is read as its own instance.
*/
function adminHostsOf(connection, config) {
	const configured = useEnv()[envKey(connection, "ADMIN_HOSTS")];
	if (Array.isArray(configured) === false || configured.length === 0) return [{
		host: String(config["host"]),
		port: Number(config["port"]) || DEFAULT_ADMIN_PORT
	}];
	return configured.map((entry) => {
		const [host, port] = String(entry).trim().split(":");
		return {
			host: String(host),
			port: Number(port) || DEFAULT_ADMIN_PORT
		};
	});
}
/**
* Every configured connection must be one the registry knows and one pgbouncer
* could actually front — it speaks the Postgres protocol and nothing else. Fail
* at boot rather than answering an empty report nobody can explain, the way a
* duplicate connection name already does.
*/
function assertPgBouncerConnections() {
	const known = new Set([getBaseConnectionName(), ...getExtraConnectionNames()]);
	for (const name of pgbouncerConnectionNames()) {
		if (known.has(name) === false) throw new Error(`PGBOUNCER_CONNECTIONS names "${name}", which is not a configured DB connection — add it to DB_CONNECTIONS or drop it here`);
		const client = resolveConnectionConfig(name)["client"];
		if (client !== "pg" && client !== "cockroachdb") throw new Error(`DB connection "${name}" uses client "${client}", which pgbouncer cannot front — only Postgres goes through it`);
	}
}
/**
* The admin consoles to read, one per pgbouncer instance. Several connections
* routinely share one instance — separate pools over the same pooler is the
* whole point of tiering — so entries are folded by `host:port` and carry every
* connection they account for.
*/
function resolvePgBouncerEndpoints() {
	const endpoints = /* @__PURE__ */ new Map();
	for (const name of pgbouncerConnectionNames()) {
		const config = resolveConnectionConfig(name);
		const reference = {
			name,
			database: String(config["database"] ?? "")
		};
		for (const { host, port } of adminHostsOf(name, config)) {
			const id = `${host}:${port}`;
			const existing = endpoints.get(id);
			if (existing) {
				existing.connections.push(reference);
				continue;
			}
			endpoints.set(id, {
				id,
				host,
				port,
				database: stringEnv(name, "ADMIN_DATABASE") ?? DEFAULT_ADMIN_DATABASE,
				user: stringEnv(name, "ADMIN_USER") ?? String(config["user"] ?? ""),
				password: stringEnv(name, "ADMIN_PASSWORD") ?? String(config["password"] ?? ""),
				connections: [reference]
			});
		}
	}
	return [...endpoints.values()];
}
/** Every part of an instance the report can carry, in display order. */
const PGBOUNCER_DETAILS = [
	"pools",
	"stats",
	"limits",
	"clients",
	"servers"
];
function isPgBouncerDetail(value) {
	return PGBOUNCER_DETAILS.includes(value);
}
/**
* What a request asked for, narrowed to what exists. `SHOW CLIENTS` on a busy
* pooler is thousands of rows, so a page polling every few seconds asks for the
* pools alone and pulls the connection lists only when one is opened.
*/
function requestedPgBouncerDetails(requested) {
	if (typeof requested !== "string" || requested.trim() === "") return [
		"pools",
		"stats",
		"limits"
	];
	return requested.split(",").map((detail) => detail.trim()).filter(isPgBouncerDetail);
}

//#endregion
export { PGBOUNCER_DETAILS, assertPgBouncerConnections, pgbouncerConnectionNames, pgbouncerQueryTimeoutMs, pgbouncerReportEnabled, requestedPgBouncerDetails, resolvePgBouncerEndpoints };