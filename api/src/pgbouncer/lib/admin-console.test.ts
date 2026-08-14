import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { closePgBouncerConsoles, showPgBouncer } from './admin-console.js';
import {
	type PgBouncerEndpoint,
	pgbouncerQueryTimeoutMs,
} from './pgbouncer-config.js';

const connect = vi.fn();
const query = vi.fn();
const end = vi.fn();
const on = vi.fn();
const constructed: any[] = [];

vi.mock('pg', () => {
	return {
		default: {
			Client: class {
				constructor(config: any) {
					constructed.push(config);
				}

				connect = connect;
				query = query;
				end = end;
				on = on;
			},
		},
	};
});

vi.mock('./pgbouncer-config.js');

vi.mock('../../logger/index.js', () => {
	return { useLogger: () => ({ trace: vi.fn() }) };
});

const endpoint: PgBouncerEndpoint = {
	id: 'pgbouncer:6432',
	host: 'pgbouncer',
	port: 6432,
	database: 'pgbouncer',
	user: 'postgres',
	password: 'secret',
	connections: [{ name: 'free', database: 'directus_free' }],
};

beforeEach(() => {
	vi.mocked(pgbouncerQueryTimeoutMs).mockReturnValue(2000);
	connect.mockResolvedValue(undefined);
	end.mockResolvedValue(undefined);
	query.mockResolvedValue({ rows: [{ version: 'PgBouncer 1.25.2' }] });
});

afterEach(async () => {
	await closePgBouncerConsoles();
	constructed.length = 0;
	vi.clearAllMocks();
});

test('The console is opened once and reused across reads', async () => {
	await showPgBouncer(endpoint, 'SHOW POOLS');
	await showPgBouncer(endpoint, 'SHOW DATABASES');

	expect(connect).toHaveBeenCalledTimes(1);
	expect(query).toHaveBeenCalledTimes(2);

	// The virtual admin database, and the timeout applied to both halves of the
	// call — a pooler that stopped answering must not hold the request open.
	expect(constructed[0]).toMatchObject({
		host: 'pgbouncer',
		port: 6432,
		database: 'pgbouncer',
		user: 'postgres',
		password: 'secret',
		connectionTimeoutMillis: 2000,
		query_timeout: 2000,
	});
});

test('The rows of the SHOW are what the caller gets', async () => {
	query.mockResolvedValue({ rows: [{ database: 'directus_free' }] });

	await expect(showPgBouncer(endpoint, 'SHOW POOLS'))
		.resolves
		.toEqual([{ database: 'directus_free' }]);
});

test('A failed read drops the session so the next one reconnects', async () => {
	query.mockRejectedValueOnce(new Error('server closed the connection'));

	await expect(showPgBouncer(endpoint, 'SHOW POOLS'))
		.rejects
		.toThrowError('server closed the connection');

	expect(end).toHaveBeenCalledTimes(1);

	// Reusing a broken session would fail every later read until a restart.
	await showPgBouncer(endpoint, 'SHOW POOLS');
	expect(connect).toHaveBeenCalledTimes(2);
});

test('Closing ends every open console', async () => {
	await showPgBouncer(endpoint, 'SHOW POOLS');
	await showPgBouncer({ ...endpoint, id: 'pgb2:6432', host: 'pgb2' }, 'SHOW POOLS');

	expect(connect).toHaveBeenCalledTimes(2);

	await closePgBouncerConsoles();
	expect(end).toHaveBeenCalledTimes(2);

	// And the map is emptied, so a later read opens a fresh one.
	await showPgBouncer(endpoint, 'SHOW POOLS');
	expect(connect).toHaveBeenCalledTimes(3);
});
