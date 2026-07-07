import { expect, test } from 'vitest';
import { getDatabasePoolExhaustedReason } from './pool-exhausted.js';

test('maps a tarn acquire timeout to client_pool_timeout', () => {
	const error = new Error('Timeout acquiring a connection');

	expect(getDatabasePoolExhaustedReason(error)).toBe('client_pool_timeout');
});

test('maps a pgbouncer query_wait_timeout to pool_queue_timeout', () => {
	const error = new Error('query_wait_timeout');

	expect(getDatabasePoolExhaustedReason(error)).toBe('pool_queue_timeout');
});

test('maps a pgbouncer max_client_conn to max_client_connections', () => {
	const error = new Error('no more connections allowed (max_client_conn)');

	expect(getDatabasePoolExhaustedReason(error)).toBe('max_client_connections');
});

test('maps postgres SQLSTATE 53300 to too_many_connections', () => {
	const error = Object.assign(new Error('too many clients'), { code: '53300' });

	expect(getDatabasePoolExhaustedReason(error)).toBe('too_many_connections');
});

test('returns null for an unrelated error or non-object', () => {
	expect(getDatabasePoolExhaustedReason(new Error('duplicate key value'))).toBeNull();
	expect(getDatabasePoolExhaustedReason(null)).toBeNull();
	expect(getDatabasePoolExhaustedReason('nope')).toBeNull();
});
