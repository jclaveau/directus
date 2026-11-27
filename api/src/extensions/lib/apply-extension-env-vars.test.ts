import { expect, test } from 'vitest';
import {
	applyExtensionEnvVars,
	type ExtensionEnvVarDeclarers,
	findUndeclaredEnvVars,
} from './apply-extension-env-vars.js';

test('casts the declared variables from their raw values or defaults', () => {
	const liveEnv: Record<string, unknown> = { CACHE_TTL: '5m' };
	const envVarDeclarers: ExtensionEnvVarDeclarers = new Map();

	applyExtensionEnvVars({
		extensionName: 'subscriptions',
		extensionEnvVars: [{
			prefix: 'SUBSCRIPTIONS_',
			vars: {
				SUBSCRIPTIONS_TRIAL_DAYS: { type: 'number', default: 14 },
				SUBSCRIPTIONS_CODE: { type: 'string' },
				SUBSCRIPTIONS_LIVE: { type: 'boolean', default: false },
				SUBSCRIPTIONS_NOTE: { type: 'string' },
			},
		}],
		envVarDeclarers,
		rawEnvVarValues: { SUBSCRIPTIONS_CODE: '0123', SUBSCRIPTIONS_LIVE: 'true' },
		liveEnv,
	});

	expect(liveEnv).toEqual({
		CACHE_TTL: '5m',
		SUBSCRIPTIONS_TRIAL_DAYS: 14,
		SUBSCRIPTIONS_CODE: '0123',
		SUBSCRIPTIONS_LIVE: true,
	});

	expect([...envVarDeclarers.keys()]).toEqual([
		'SUBSCRIPTIONS_TRIAL_DAYS',
		'SUBSCRIPTIONS_CODE',
		'SUBSCRIPTIONS_LIVE',
		'SUBSCRIPTIONS_NOTE',
	]);
});

test('refuses every misfit at once and writes nothing', () => {
	const liveEnv: Record<string, unknown> = {};

	const envVarDeclarers: ExtensionEnvVarDeclarers = new Map([[
		'SUBSCRIPTIONS_SHARED',
		{ extensionName: 'billing', envVarDeclaration: { type: 'string' } },
	]]);

	expect(() => {
		return applyExtensionEnvVars({
			extensionName: 'subscriptions',
			extensionEnvVars: [
				{
					prefix: 'SUBSCRIPTIONS_',
					vars: {
						SUBSCRIPTIONS_PORT: { type: 'number' },
						SUBSCRIPTIONS_SHARED: { type: 'number' },
						SUBSCRIPTIONS_DAYS: { type: 'number', default: 3 },
					},
				},
				{ prefix: 'CACHE_', vars: { CACHE_TTL: { type: 'string' } } },
			],
			envVarDeclarers,
			rawEnvVarValues: { SUBSCRIPTIONS_PORT: 'abc' },
			liveEnv,
		});
	}).toThrow(new Error([
		'Extension "subscriptions": "SUBSCRIPTIONS_PORT" is "abc",'
		+ ' which is not a number.',
		'Extension "subscriptions" declares "SUBSCRIPTIONS_SHARED" number,'
		+ ' which extension "billing" declares string.',
		'Extension "subscriptions" declares the prefix "CACHE_", which is core\'s.',
		'Extension "subscriptions" declares "CACHE_TTL", which core declares.',
	].join('\n')));

	expect(liveEnv).toEqual({});
	expect([...envVarDeclarers.keys()]).toEqual(['SUBSCRIPTIONS_SHARED']);
});

test('accepts the same name another extension declares as the same type', () => {
	const liveEnv: Record<string, unknown> = {};

	const envVarDeclarers: ExtensionEnvVarDeclarers = new Map([[
		'SUBSCRIPTIONS_SHARED',
		{ extensionName: 'billing', envVarDeclaration: { type: 'number' } },
	]]);

	applyExtensionEnvVars({
		extensionName: 'subscriptions',
		extensionEnvVars: [{
			prefix: 'SUBSCRIPTIONS_',
			vars: { SUBSCRIPTIONS_SHARED: { type: 'number' } },
		}],
		envVarDeclarers,
		rawEnvVarValues: { SUBSCRIPTIONS_SHARED: '7' },
		liveEnv,
	});

	expect(liveEnv).toEqual({ SUBSCRIPTIONS_SHARED: 7 });
});

test('refuses a name another extension declares with another default', () => {
	const liveEnv: Record<string, unknown> = {};

	const envVarDeclarers: ExtensionEnvVarDeclarers = new Map([[
		'ACME_TTL',
		{
			extensionName: 'acme',
			envVarDeclaration: { type: 'number', default: 10 },
		},
	]]);

	expect(() => {
		applyExtensionEnvVars({
			extensionName: 'beta',
			extensionEnvVars: [{
				prefix: 'ACME_',
				vars: { ACME_TTL: { type: 'number', default: 60 } },
			}],
			envVarDeclarers,
			rawEnvVarValues: {},
			liveEnv,
		});
	}).toThrow(new Error(
		'Extension "beta" declares "ACME_TTL" default 60,'
		+ ' which extension "acme" declares 10.',
	));

	expect(liveEnv).toEqual({});
});

test('finds the names set under a declared prefix that nobody declares', () => {
	expect(findUndeclaredEnvVars({
		rawEnvVarNames: [
			'CACHE_TTL',
			'CACHE_TTLL',
			'SUBSCRIPTIONS_TRIAL_DAYS',
			'SUBSCRIPTIONS_TRIAL_DAY',
			'PM2_HOME',
			'HOME',
		],
		envVarDeclarers: new Map([[
			'SUBSCRIPTIONS_TRIAL_DAYS',
			{ extensionName: 'subscriptions', envVarDeclaration: { type: 'number' } },
		]]),
		extensionPrefixes: new Set(['SUBSCRIPTIONS_']),
	})).toEqual(['CACHE_TTLL', 'SUBSCRIPTIONS_TRIAL_DAY']);
});

test('finds a typo under a library prefix core forwards', () => {
	expect(findUndeclaredEnvVars({
		rawEnvVarNames: ['DB_HOST', 'DB_HOTS', 'HSTS_MAX_AGES', 'DB_SSL__CA'],
		envVarDeclarers: new Map(),
		extensionPrefixes: new Set(),
	})).toEqual(['DB_HOTS', 'HSTS_MAX_AGES']);
});
