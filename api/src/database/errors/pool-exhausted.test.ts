import { expect, test } from 'vitest';
import { getDatabasePoolExhaustedReason } from './pool-exhausted.js';

test('maps a tarn acquire timeout to client_pool_timeout', () => {
	const error = new Error('Timeout acquiring a connection');

	expect(getDatabasePoolExhaustedReason(error, 'postgres')).toBe('client_pool_timeout');
});

test('maps a pgbouncer query_wait_timeout to pool_queue_timeout', () => {
	const error = new Error('query_wait_timeout');

	expect(getDatabasePoolExhaustedReason(error, 'postgres')).toBe('pool_queue_timeout');
});

test('maps a pgbouncer max_client_conn to max_client_connections', () => {
	const error = new Error('no more connections allowed (max_client_conn)');

	const reason = getDatabasePoolExhaustedReason(error, 'postgres');

	expect(reason).toBe('max_client_connections');
});

test('maps postgres SQLSTATE 53300 to too_many_connections', () => {
	const error = Object.assign(new Error('too many clients'), { code: '53300' });

	expect(getDatabasePoolExhaustedReason(error, 'postgres')).toBe('too_many_connections');
});

test('returns null for an unrelated error or non-object', () => {
	const unrelated = new Error('duplicate key value');

	expect(getDatabasePoolExhaustedReason(unrelated, 'postgres')).toBeNull();
	expect(getDatabasePoolExhaustedReason(null, 'postgres')).toBeNull();
	expect(getDatabasePoolExhaustedReason('nope', 'postgres')).toBeNull();
});

test('does not classify pool errors for non-pg dialects (pgbouncer is pg-only)', () => {
	const error = new Error('Timeout acquiring a connection');

	expect(getDatabasePoolExhaustedReason(error, 'sqlite')).toBeNull();
	expect(getDatabasePoolExhaustedReason(error, 'mysql')).toBeNull();
});
