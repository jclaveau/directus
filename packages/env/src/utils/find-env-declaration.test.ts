import { expect, expectTypeOf, test } from 'vitest';
import type { Env } from '../types/env.js';
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

test('finds a login timeout guessed, so 300 is read as 300 seconds', () => {
	expect(findEnvDeclaration('AUTH_OKTA_LOGIN_TIMEOUT')).toEqual({
		type: 'boolean | number | string | string[]',
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
])('finds nothing for %j, a typo under a library prefix', (name) => {
	expect(findEnvDeclaration(name)).toBe(null);
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
])('finds %j declared by name', (name, envDeclaration) => {
	expect(findEnvDeclaration(name.replace('*', 'REPLICA')))
		.toEqual(envDeclaration);
});

test.each([
	'DB_SSL__REJECT_UNAUTHORIZED',
	'CONTENT_SECURITY_POLICY_DIRECTIVES__SCRIPT_SRC',
	'ASSETS_CONTENT_SECURITY_POLICY_DIRECTIVES__IMG_SRC',
])('finds %j under a pattern a reader forwards', (name) => {
	expect(findEnvDeclaration(name)).toEqual({});
});

test('types no DB_HOTS on Env', () => {
	expectTypeOf<Env>().not.toHaveProperty('DB_HOTS');
});
