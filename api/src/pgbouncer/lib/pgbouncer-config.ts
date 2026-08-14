import { useEnv } from '@directus/env';
import type { PgBouncerDetail } from '@directus/types';
import {
	getBaseConnectionName,
	getExtraConnectionNames,
	resolveConnectionConfig,
} from '../../database/connections.js';
import { getMilliseconds } from '../../utils/get-milliseconds.js';

/** pgbouncer's own default listen port, used when a host carries none. */
const DEFAULT_ADMIN_PORT = 6432;

/** The virtual database the admin console answers on. */
const DEFAULT_ADMIN_DATABASE = 'pgbouncer';

/** One registry connection reaching a pooler, and the pool it lands in. */
export interface PgBouncerConnectionRef {
	name: string;
	/** The pgbouncer database this connection opens, i.e. its pool. */
	database: string;
}

/** One admin console to read, and the connections it accounts for. */
export interface PgBouncerEndpoint {
	/** `host:port` — what makes two entries the same pgbouncer instance. */
	id: string;
	host: string;
	port: number;
	database: string;
	user: string;
	password: string;
	connections: PgBouncerConnectionRef[];
}

/**
 * Whether this node serves the pgbouncer report at all. Off removes the
 * endpoint, so a deployment without a pooler has no dead page — the report is
 * admin-only either way.
 */
export function pgbouncerReportEnabled(): boolean {
	return useEnv()['PGBOUNCER_REPORT_ENABLED'] === true;
}

/** The registry connections that reach Postgres through pgbouncer. */
export function pgbouncerConnectionNames(): string[] {
	const configured = useEnv()['PGBOUNCER_CONNECTIONS'];

	if (Array.isArray(configured) === false) {
		return [];
	}

	return configured
		.map((name) => String(name).trim())
		.filter(Boolean);
}

/** How long a single admin query may take before it is given up on. */
export function pgbouncerQueryTimeoutMs(): number {
	return getMilliseconds(useEnv()['PGBOUNCER_QUERY_TIMEOUT'], 2000);
}

function envKey(connection: string, suffix: string): string {
	return `PGBOUNCER_${connection.toUpperCase()}_${suffix}`;
}

function stringEnv(connection: string, suffix: string): string | null {
	const value = useEnv()[envKey(connection, suffix)];

	return typeof value === 'string' && value !== ''
		? value
		: null;
}

/**
 * The admin endpoints of one connection. Defaults to the pooler the connection
 * itself talks to; an HA fleet sits behind one address and would answer for
 * whichever process took the connection, so `_ADMIN_HOSTS` names its members
 * explicitly and each is read as its own instance.
 */
function adminHostsOf(
	connection: string,
	config: Record<string, any>,
): { host: string; port: number }[] {
	const configured = useEnv()[envKey(connection, 'ADMIN_HOSTS')];

	if (Array.isArray(configured) === false || configured.length === 0) {
		return [{
			host: String(config['host']),
			port: Number(config['port']) || DEFAULT_ADMIN_PORT,
		}];
	}

	return configured.map((entry) => {
		const [host, port] = String(entry)
			.trim()
			.split(':');

		return {
			host: String(host),
			port: Number(port) || DEFAULT_ADMIN_PORT,
		};
	});
}

/**
 * Every configured connection must be one the registry knows and one pgbouncer
 * could actually front — it speaks the Postgres protocol and nothing else. Fail
 * at boot rather than answering an empty report nobody can explain, the way a
 * duplicate connection name already does.
 */
export function assertPgBouncerConnections(): void {
	const known = new Set([
		getBaseConnectionName(),
		...getExtraConnectionNames(),
	]);

	for (const name of pgbouncerConnectionNames()) {
		if (known.has(name) === false) {
			throw new Error(
				`PGBOUNCER_CONNECTIONS names "${name}", which is not a configured `
				+ `DB connection — add it to DB_CONNECTIONS or drop it here`,
			);
		}

		const client = resolveConnectionConfig(name)['client'];

		if (client !== 'pg' && client !== 'cockroachdb') {
			throw new Error(
				`DB connection "${name}" uses client "${client}", which pgbouncer `
				+ `cannot front — only Postgres goes through it`,
			);
		}
	}
}

/**
 * The admin consoles to read, one per pgbouncer instance. Several connections
 * routinely share one instance — separate pools over the same pooler is the
 * whole point of tiering — so entries are folded by `host:port` and carry every
 * connection they account for.
 */
export function resolvePgBouncerEndpoints(): PgBouncerEndpoint[] {
	const endpoints = new Map<string, PgBouncerEndpoint>();

	for (const name of pgbouncerConnectionNames()) {
		const config = resolveConnectionConfig(name);

		const reference: PgBouncerConnectionRef = {
			name,
			database: String(config['database'] ?? ''),
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
				database: stringEnv(name, 'ADMIN_DATABASE') ?? DEFAULT_ADMIN_DATABASE,
				user: stringEnv(name, 'ADMIN_USER') ?? String(config['user'] ?? ''),
				password: stringEnv(name, 'ADMIN_PASSWORD')
					?? String(config['password'] ?? ''),
				connections: [reference],
			});
		}
	}

	return [...endpoints.values()];
}

/** Every part of an instance the report can carry, in display order. */
export const PGBOUNCER_DETAILS: PgBouncerDetail[] = [
	'pools',
	'stats',
	'limits',
	'clients',
	'servers',
];

function isPgBouncerDetail(value: unknown): value is PgBouncerDetail {
	return PGBOUNCER_DETAILS.includes(value as PgBouncerDetail);
}

/**
 * What a request asked for, narrowed to what exists. `SHOW CLIENTS` on a busy
 * pooler is thousands of rows, so a page polling every few seconds asks for the
 * pools alone and pulls the connection lists only when one is opened.
 */
export function requestedPgBouncerDetails(
	requested: unknown,
): PgBouncerDetail[] {
	if (typeof requested !== 'string' || requested.trim() === '') {
		return ['pools', 'stats', 'limits'];
	}

	return requested
		.split(',')
		.map((detail) => detail.trim())
		.filter(isPgBouncerDetail);
}
