import { expect, test } from 'vitest';
import { findEnvDeclaration } from './find-env-declaration.js';

test('finds a literal declaration', () => {
	expect(findEnvDeclaration('CACHE_STORE')).toEqual({
		type: 'string',
		default: 'memory',
		values: ['memory', 'redis'],
	});
});

test('finds a declaration by the glob of its name', () => {
	expect(findEnvDeclaration('DB_CONNECTION_REPLICA_PORT'))
		.toEqual({ type: 'number' });
});

test('finds a typed glob before a guessed one', () => {
	expect(findEnvDeclaration('DB_POOL__MIN')).toEqual({ type: 'number' });
});

test('finds a literal declaration with its default', () => {
	expect(findEnvDeclaration('ROOT_REDIRECT')).toEqual({
		type: 'false | string',
		default: './admin',
	});
});

test('finds a guessed declaration by the glob of its name', () => {
	expect(findEnvDeclaration('AUTH_GOOGLE_CLIENT_HTTP_TIMEOUT')).toEqual({});
});

test('finds nothing for an undeclared name', () => {
	expect(findEnvDeclaration('SUBSCRIPTIONS_TRIAL_DAYS')).toBe(null);
});
