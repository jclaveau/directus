import { expect, expectTypeOf, test } from 'vitest';
import type { Env } from '../types/env.js';
import { findEnvVarDeclaration } from './find-env-var-declaration.js';

test('finds a literal declaration', () => {
	expect(findEnvVarDeclaration('CACHE_STORE')).toEqual({
		type: 'string',
		default: 'memory',
		values: ['memory', 'redis'],
	});
});

test('finds a declaration by the glob of its name', () => {
	expect(findEnvVarDeclaration('DB_CONNECTION_REPLICA_PORT'))
		.toEqual({ type: 'number' });
});

test('finds a typed glob before a guessed one', () => {
	expect(findEnvVarDeclaration('DB_POOL__MIN')).toEqual({ type: 'number' });
});

test('finds a literal declaration with its default', () => {
	expect(findEnvVarDeclaration('ROOT_REDIRECT')).toEqual({
		type: 'false | string',
		default: './admin',
	});
});

test('finds a guessed declaration by the glob of its name', () => {
	expect(findEnvVarDeclaration('AUTH_GOOGLE_CLIENT_HTTP_HEADERS')).toEqual({});
});

test('finds nothing for an undeclared name', () => {
	expect(findEnvVarDeclaration('SUBSCRIPTIONS_TRIAL_DAYS')).toBe(null);
});

test('finds a login timeout typed, so 300 is read as 300 seconds', () => {
	expect(findEnvVarDeclaration('AUTH_OKTA_LOGIN_TIMEOUT')).toEqual({
		type: 'number | string',
	});
});

test.each([
	'DB_HOTS',
	'LOGGER_LEVLES',
	'SERVER_KEEP_ALIVE_TIMOUT',
	'HASH_MEMORY_COSTS',
	'HSTS_MAX_AGES',
	'CONTENT_SECURITY_POLICY_USE_DEFAULT',
	'ASSETS_CONTENT_SECURITY_POLICY_REPORT_ONLI',
	'RATE_LIMITER_POINT',
])('finds nothing for %j, a typo under a library prefix', (envVarName) => {
	expect(findEnvVarDeclaration(envVarName)).toBe(null);
});

test.each([
	['DB_HOST', { type: 'string' }],
	['DB_CONNECTION_*_HOST', { type: 'string' }],
	['LOGGER_LEVELS', { type: 'string[]' }],
	['SERVER_KEEP_ALIVE_TIMEOUT', { type: 'number' }],
	['HASH_MEMORY_COST', { type: 'number' }],
	['HSTS_MAX_AGE', { type: 'number' }],
	['CONTENT_SECURITY_POLICY_USE_DEFAULTS', { type: 'boolean' }],
	['ASSETS_CONTENT_SECURITY_POLICY_REPORT_ONLY', { type: 'boolean' }],
	['RATE_LIMITER_BLOCK_DURATION', { type: 'number' }],
	['RATE_LIMITER_GLOBAL_BLOCK_DURATION', { type: 'number' }],
])('finds %j declared by name', (envVarName, envVarDeclaration) => {
	expect(findEnvVarDeclaration(envVarName.replace('*', 'REPLICA')))
		.toEqual(envVarDeclaration);
});

test.each([
	['DB_SSL__REJECT_UNAUTHORIZED', { type: 'boolean' }],
	['DB_SSL__ALPN_PROTOCOLS', {}],
	['CONTENT_SECURITY_POLICY_DIRECTIVES__SCRIPT_SRC', { type: 'null | string[]' }],
	[
		'ASSETS_CONTENT_SECURITY_POLICY_DIRECTIVES__IMG_SRC',
		{ type: 'null | string[]' },
	],
])('finds %j under a pattern a reader forwards', (
	envVarName,
	envVarDeclaration,
) => {
	expect(findEnvVarDeclaration(envVarName)).toEqual(envVarDeclaration);
});

test('types no DB_HOTS on Env', () => {
	expectTypeOf<Env>().not.toHaveProperty('DB_HOTS');
});

test('finds no declaration for the auth name no driver reads', () => {
	expect(findEnvVarDeclaration('AUTH_OKTA_AUTH_REQUIRE_VERIFIED_EMAIL'))
		.toBeNull();
});
