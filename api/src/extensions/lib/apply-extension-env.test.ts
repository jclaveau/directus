import { expect, test } from 'vitest';
import {
	applyExtensionEnv,
	type ExtensionEnvDeclarers,
	findUndeclaredEnv,
} from './apply-extension-env.js';

test('casts the declared variables from their raw values or defaults', () => {
	const env: Record<string, unknown> = { CACHE_TTL: '5m' };
	const envDeclarers: ExtensionEnvDeclarers = new Map();

	applyExtensionEnv({
		extensionName: 'subscriptions',
		extensionEnvs: [{
			prefix: 'SUBSCRIPTIONS_',
			vars: {
				SUBSCRIPTIONS_TRIAL_DAYS: { type: 'number', default: 14 },
				SUBSCRIPTIONS_CODE: { type: 'string' },
				SUBSCRIPTIONS_LIVE: { type: 'boolean', default: false },
				SUBSCRIPTIONS_NOTE: { type: 'string' },
			},
		}],
		envDeclarers,
		rawValues: { SUBSCRIPTIONS_CODE: '0123', SUBSCRIPTIONS_LIVE: 'true' },
		env,
	});

	expect(env).toEqual({
		CACHE_TTL: '5m',
		SUBSCRIPTIONS_TRIAL_DAYS: 14,
		SUBSCRIPTIONS_CODE: '0123',
		SUBSCRIPTIONS_LIVE: true,
	});

	expect([...envDeclarers.keys()]).toEqual([
		'SUBSCRIPTIONS_TRIAL_DAYS',
		'SUBSCRIPTIONS_CODE',
		'SUBSCRIPTIONS_LIVE',
		'SUBSCRIPTIONS_NOTE',
	]);
});

test('refuses every misfit at once and writes nothing', () => {
	const env: Record<string, unknown> = {};

	const envDeclarers: ExtensionEnvDeclarers = new Map([[
		'SUBSCRIPTIONS_SHARED',
		{ extensionName: 'billing', envDeclaration: { type: 'string' } },
	]]);

	expect(() => {
		return applyExtensionEnv({
			extensionName: 'subscriptions',
			extensionEnvs: [
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
			envDeclarers,
			rawValues: { SUBSCRIPTIONS_PORT: 'abc' },
			env,
		});
	}).toThrow(new Error([
		'Extension "subscriptions": "SUBSCRIPTIONS_PORT" is "abc",'
		+ ' which is not a number.',
		'Extension "subscriptions" declares "SUBSCRIPTIONS_SHARED" number,'
		+ ' which extension "billing" declares string.',
		'Extension "subscriptions" declares the prefix "CACHE_", which is core\'s.',
		'Extension "subscriptions" declares "CACHE_TTL", which core declares.',
	].join('\n')));

	expect(env).toEqual({});
	expect([...envDeclarers.keys()]).toEqual(['SUBSCRIPTIONS_SHARED']);
});

test('accepts the same name another extension declares as the same type', () => {
	const env: Record<string, unknown> = {};

	const envDeclarers: ExtensionEnvDeclarers = new Map([[
		'SUBSCRIPTIONS_SHARED',
		{ extensionName: 'billing', envDeclaration: { type: 'number' } },
	]]);

	applyExtensionEnv({
		extensionName: 'subscriptions',
		extensionEnvs: [{
			prefix: 'SUBSCRIPTIONS_',
			vars: { SUBSCRIPTIONS_SHARED: { type: 'number' } },
		}],
		envDeclarers,
		rawValues: { SUBSCRIPTIONS_SHARED: '7' },
		env,
	});

	expect(env).toEqual({ SUBSCRIPTIONS_SHARED: 7 });
});

test('finds the names set under a declared prefix that nobody declares', () => {
	expect(findUndeclaredEnv({
		rawNames: [
			'CACHE_TTL',
			'CACHE_TTLL',
			'SUBSCRIPTIONS_TRIAL_DAYS',
			'SUBSCRIPTIONS_TRIAL_DAY',
			'PM2_HOME',
			'HOME',
		],
		envDeclarers: new Map([[
			'SUBSCRIPTIONS_TRIAL_DAYS',
			{ extensionName: 'subscriptions', envDeclaration: { type: 'number' } },
		]]),
		extensionPrefixes: new Set(['SUBSCRIPTIONS_']),
	})).toEqual(['CACHE_TTLL', 'SUBSCRIPTIONS_TRIAL_DAY']);
});
