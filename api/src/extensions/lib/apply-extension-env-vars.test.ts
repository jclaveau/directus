import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

test('reads a declared variable from the file its _FILE variable names', () => {
	const secretDir = mkdtempSync(join(tmpdir(), 'extension-env-file-'));
	writeFileSync(join(secretDir, 'key'), 'sk_live_abc\n');
	writeFileSync(join(secretDir, 'days'), '30\n');
	const liveEnv: Record<string, unknown> = {};

	applyExtensionEnvVars({
		extensionName: 'subscriptions',
		extensionEnvVars: [{
			prefix: 'SUBSCRIPTIONS_',
			vars: {
				SUBSCRIPTIONS_KEY: { type: 'string' },
				SUBSCRIPTIONS_DAYS: { type: 'number', default: 14 },
			},
		}],
		envVarDeclarers: new Map(),
		rawEnvVarValues: {
			SUBSCRIPTIONS_KEY_FILE: join(secretDir, 'key'),
			SUBSCRIPTIONS_DAYS_FILE: join(secretDir, 'days'),
		},
		liveEnv,
	});

	expect(liveEnv).toEqual({
		SUBSCRIPTIONS_KEY: 'sk_live_abc',
		SUBSCRIPTIONS_DAYS: 30,
	});
});

test('refuses a _FILE variable whose file cannot be read', () => {
	const liveEnv: Record<string, unknown> = {};

	expect(() => {
		applyExtensionEnvVars({
			extensionName: 'subscriptions',
			extensionEnvVars: [{
				prefix: 'SUBSCRIPTIONS_',
				vars: { SUBSCRIPTIONS_KEY: { type: 'string' } },
			}],
			envVarDeclarers: new Map(),
			rawEnvVarValues: { SUBSCRIPTIONS_KEY_FILE: '/missing/key' },
			liveEnv,
		});
	}).toThrow(new Error(
		'Extension "subscriptions": Failed to read value from file'
		+ ' "/missing/key", defined in environment variable'
		+ ' "SUBSCRIPTIONS_KEY_FILE".',
	));

	expect(liveEnv).toEqual({});
});

test('refuses a _FILE variable that is not a path', () => {
	const liveEnv: Record<string, unknown> = {};

	expect(() => {
		applyExtensionEnvVars({
			extensionName: 'subscriptions',
			extensionEnvVars: [{
				prefix: 'SUBSCRIPTIONS_',
				vars: { SUBSCRIPTIONS_KEY: { type: 'string', default: 'sk_test' } },
			}],
			envVarDeclarers: new Map(),
			rawEnvVarValues: { SUBSCRIPTIONS_KEY_FILE: 123 },
			liveEnv,
		});
	}).toThrow(new Error(
		'Extension "subscriptions": "SUBSCRIPTIONS_KEY_FILE" is 123,'
		+ ' which is not a file path.',
	));

	expect(liveEnv).toEqual({});
});

test('refuses a variable set both directly and through its _FILE variable', () => {
	const liveEnv: Record<string, unknown> = {};

	expect(() => {
		applyExtensionEnvVars({
			extensionName: 'subscriptions',
			extensionEnvVars: [{
				prefix: 'SUBSCRIPTIONS_',
				vars: { SUBSCRIPTIONS_KEY: { type: 'string' } },
			}],
			envVarDeclarers: new Map(),
			rawEnvVarValues: {
				SUBSCRIPTIONS_KEY: 'sk_live_env',
				SUBSCRIPTIONS_KEY_FILE: '/run/secrets/key',
			},
			liveEnv,
		});
	}).toThrow(new Error(
		'Extension "subscriptions": "SUBSCRIPTIONS_KEY" and'
		+ ' "SUBSCRIPTIONS_KEY_FILE" are both set. Set only one.',
	));

	expect(liveEnv).toEqual({});
});

test('refuses a secret file value without printing it', () => {
	const secretDir = mkdtempSync(join(tmpdir(), 'extension-env-file-'));
	writeFileSync(join(secretDir, 'key'), 'sk_live_abc\n');

	expect(() => {
		applyExtensionEnvVars({
			extensionName: 'subscriptions',
			extensionEnvVars: [{
				prefix: 'SUBSCRIPTIONS_',
				vars: { SUBSCRIPTIONS_KEY: { type: 'number' } },
			}],
			envVarDeclarers: new Map(),
			rawEnvVarValues: { SUBSCRIPTIONS_KEY_FILE: join(secretDir, 'key') },
			liveEnv: {},
		});
	}).toThrow(new Error(
		'Extension "subscriptions": "SUBSCRIPTIONS_KEY" is not a number.',
	));
});

test('counts the _FILE variable of a declared name as declared', () => {
	expect(findUndeclaredEnvVars({
		rawEnvVarNames: ['SUBSCRIPTIONS_KEY_FILE', 'SUBSCRIPTIONS_KYE_FILE'],
		envVarDeclarers: new Map([[
			'SUBSCRIPTIONS_KEY',
			{ extensionName: 'subscriptions', envVarDeclaration: { type: 'string' } },
		]]),
		extensionPrefixes: new Set(['SUBSCRIPTIONS_']),
	})).toEqual(['SUBSCRIPTIONS_KYE_FILE']);
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
