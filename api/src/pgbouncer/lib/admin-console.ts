import pg from 'pg';
import { useLogger } from '../../logger/index.js';
import {
	type PgBouncerEndpoint,
	pgbouncerQueryTimeoutMs,
} from './pgbouncer-config.js';

/** One row of a `SHOW` result: pgbouncer answers in text, never typed. */
export type AdminRow = Record<string, string | number | null>;

/**
 * pgbouncer's admin console is not Postgres: it answers `SHOW`, and nothing
 * else. knex cannot be used for it — its `pg` dialect issues `select version();`
 * on every new connection, which the console rejects with
 * `invalid command 'select version();', use SHOW HELP;`, so every query on a
 * knex-built pool fails. Hence a bare client per endpoint, kept for the process
 * lifetime like the named pools are.
 */
const consoles = new Map<string, pg.Client>();

function keyOf(endpoint: PgBouncerEndpoint): string {
	return `${endpoint.id}/${endpoint.database}/${endpoint.user}`;
}

async function connect(endpoint: PgBouncerEndpoint): Promise<pg.Client> {
	const timeout = pgbouncerQueryTimeoutMs();

	const client = new pg.Client({
		host: endpoint.host,
		port: endpoint.port,
		database: endpoint.database,
		user: endpoint.user,
		password: endpoint.password,
		connectionTimeoutMillis: timeout,
		query_timeout: timeout,
		application_name: 'directus-pgbouncer-admin',
	});

	// A console that drops out from under us must not keep the dead client in the
	// map, or every later read fails until the process restarts.
	client.on('error', (error) => {
		useLogger().trace(error, '[pgbouncer] admin console connection lost');
		consoles.delete(keyOf(endpoint));
	});

	await client.connect();
	return client;
}

/**
 * Run one `SHOW` against an endpoint's admin console. A failed query drops the
 * client so the next read reconnects rather than reusing a broken session.
 */
export async function showPgBouncer(
	endpoint: PgBouncerEndpoint,
	command: string,
): Promise<AdminRow[]> {
	const key = keyOf(endpoint);

	let client = consoles.get(key);

	if (client === undefined) {
		client = await connect(endpoint);
		consoles.set(key, client);
	}

	try {
		const result = await client.query(command);
		return result.rows;
	}
	catch (error) {
		consoles.delete(key);
		await client.end().catch(() => {});
		throw error;
	}
}

/** Close every open console, so a shutdown leaves no session behind. */
export async function closePgBouncerConsoles(): Promise<void> {
	const open = [...consoles.values()];

	consoles.clear();

	await Promise.all(open.map((client) => client.end().catch(() => {})));
}
