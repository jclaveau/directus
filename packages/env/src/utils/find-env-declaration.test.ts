import { expect, test } from 'vitest';
import { findEnvDeclaration } from './find-env-declaration.js';

test('finds a literal declaration', () => {
	expect(findEnvDeclaration('CACHE_STORE')).toEqual({
		type: 'string',
		default: 'memory',
		values: ['memory', 'redis'],
	});
});

test('finds a declaration by the pattern of its name', () => {
	expect(findEnvDeclaration('DB_CONNECTION_REPLICA_PORT'))
		.toEqual({ type: 'number' });
});

test('finds nothing for an undeclared name', () => {
	expect(findEnvDeclaration('AUTH_PROVIDERS')).toBe(null);
});
