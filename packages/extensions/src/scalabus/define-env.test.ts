import { describe, expect, expectTypeOf, test } from 'vitest';
import { defineBundleApi, defineHook } from './define-entry.js';
import { defineEnv } from './define-env.js';

const subscriptionsVars = {
	SUBSCRIPTIONS_TRIAL_DAYS: { type: 'number', default: 14 },
	SUBSCRIPTIONS_MODE: { type: 'string', values: ['live', 'test'] },
} as const;

describe('defineEnv', () => {
	test('stamps its declarations on every entry it defines', () => {
		const subscriptionsEnv = defineEnv({
			prefix: 'SUBSCRIPTIONS_',
			vars: subscriptionsVars,
		});

		const hookConfig = () => {};

		const endpointConfig = () => {};

		const operationHandler = () => null;

		const migrationUp = async () => {};

		const migrationDown = async () => {};

		const declaredEnvVars = { prefix: 'SUBSCRIPTIONS_', vars: subscriptionsVars };

		expect([
			subscriptionsEnv.defineHook('trials', hookConfig),
			subscriptionsEnv.defineEndpoint('checkout', endpointConfig),
			subscriptionsEnv.defineOperationApi('notify', {
				id: 'notify',
				handler: operationHandler,
			}),
			subscriptionsEnv.defineMigration('20261124A-add-plans', {
				up: migrationUp,
				down: migrationDown,
			}),
		]).toEqual([
			{ type: 'hook', name: 'trials', config: hookConfig, env: declaredEnvVars },
			{
				type: 'endpoint',
				name: 'checkout',
				config: endpointConfig,
				env: declaredEnvVars,
			},
			{
				type: 'operation',
				name: 'notify',
				config: { id: 'notify', handler: operationHandler },
				env: declaredEnvVars,
			},
			{
				type: 'migration',
				name: '20261124A-add-plans',
				config: { up: migrationUp, down: migrationDown, phase: 'before-schema' },
				env: declaredEnvVars,
			},
		]);
	});

	test('types context.env with core\'s variables and its own', () => {
		const subscriptionsEnv = defineEnv({
			prefix: 'SUBSCRIPTIONS_',
			vars: subscriptionsVars,
		});

		subscriptionsEnv.defineHook('trials', (_register, { env }) => {
			expectTypeOf(env.SUBSCRIPTIONS_TRIAL_DAYS).toEqualTypeOf<number>();

			expectTypeOf(env.SUBSCRIPTIONS_MODE)
				.toEqualTypeOf<'live' | 'test' | undefined>();

			expectTypeOf(env.CACHE_ENABLED).toEqualTypeOf<boolean>();
		});
	});

	test.each(['DB_VACUUM_', 'SUBSCRIPTIONS_STRIPE_'])(
		'accepts the prefix %j, of several words',
		(envVarPrefix) => {
			const cronVars = {
				[`${envVarPrefix}CRON_FREQUENCY`]: { type: 'string' },
			} as const;

			const cronEnv = defineEnv({ prefix: envVarPrefix, vars: cronVars });

			expect({ prefix: cronEnv.prefix, vars: cronEnv.vars })
				.toEqual({ prefix: envVarPrefix, vars: cronVars });
		},
	);

	test.each([
		'SUBSCRIPTIONS',
		'subscriptions_',
		'SUBSCRIPTIONS__',
		'SUBSCRIPTIONS__STRIPE_',
		'_SUBSCRIPTIONS_',
		'',
	])('refuses the malformed prefix %j', (envVarPrefix) => {
		expect(() => defineEnv({ prefix: envVarPrefix, vars: {} }))
			.toThrow(new Error(
				`Env prefix ${JSON.stringify(envVarPrefix)} must be upper case`
					+ ' words, each ending in one "_", like "SUBSCRIPTIONS_" or'
					+ ' "SUBSCRIPTIONS_STRIPE_"',
			));
	});

	test.each(['DB_', 'ASSETS_CONTENT_SECURITY_POLICY_'])(
		'refuses the core prefix %j',
		(envVarPrefix) => {
			expect(() => defineEnv({ prefix: envVarPrefix, vars: {} }))
				.toThrow(new Error(
					`Env prefix ${JSON.stringify(envVarPrefix)} is core's.`,
				));
		},
	);

	test('refuses a variable outside its prefix of several words', () => {
		expect(() => {
			return defineEnv({
				prefix: 'DB_VACUUM_',
				vars: { DB_HOTS: { type: 'string' } },
			});
		}).toThrow(new Error(
			'Env variable "DB_HOTS" is not named under its prefix "DB_VACUUM_"',
		));
	});

	test('refuses a variable named outside its prefix', () => {
		expect(() => {
			return defineEnv({
				prefix: 'SUBSCRIPTIONS_',
				vars: { BILLING_DAYS: { type: 'number' } },
			});
		}).toThrow(new Error(
			'Env variable "BILLING_DAYS" is not named under its prefix'
				+ ' "SUBSCRIPTIONS_"',
		));
	});

	test.each(['SUBSCRIPTIONS_', 'SUBSCRIPTIONS_FOO_'])(
		'refuses a variable named %j, ending in "_"',
		(envVarName) => {
			expect(() => {
				return defineEnv({
					prefix: 'SUBSCRIPTIONS_',
					vars: { [envVarName]: { type: 'number' } },
				});
			}).toThrow(new Error(
				`Env variable ${JSON.stringify(envVarName)} must not end with "_"`,
			));
		},
	);
});

describe('defineBundleApi with an env', () => {
	test('stamps the bundle env on the entries without their own', () => {
		const hookConfig = () => {};

		const billingVars = { BILLING_DAYS: { type: 'number' } } as const;
		const billingEnv = defineEnv({ prefix: 'BILLING_', vars: billingVars });

		expect(defineBundleApi({
			env: { prefix: 'SUBSCRIPTIONS_', vars: subscriptionsVars },
			entries: [
				defineHook('audit', hookConfig),
				billingEnv.defineHook('invoices', hookConfig),
			],
		})).toEqual({
			format: 'scalabus/1',
			entries: [
				{
					type: 'hook',
					name: 'audit',
					config: hookConfig,
					env: { prefix: 'SUBSCRIPTIONS_', vars: subscriptionsVars },
				},
				{
					type: 'hook',
					name: 'invoices',
					config: hookConfig,
					env: { prefix: 'BILLING_', vars: billingVars },
				},
			],
		});
	});

	test('refuses two entries with the same name', () => {
		const hookConfig = () => {};

		expect(() => {
			return defineBundleApi({
				env: { prefix: 'SUBSCRIPTIONS_', vars: subscriptionsVars },
				entries: [
					defineHook('audit', hookConfig),
					defineHook('audit', hookConfig),
				],
			});
		}).toThrow(new Error('Bundle entries repeat the name "audit"'));
	});

	test('refuses a bundle env whose prefix is malformed', () => {
		expect(() => {
			return defineBundleApi({
				env: { prefix: '', vars: { PORT: { type: 'number' } } },
				entries: [defineHook('audit', () => {})],
			});
		}).toThrow(new Error(
			'Env prefix "" must be upper case words, each ending in one "_",'
				+ ' like "SUBSCRIPTIONS_" or "SUBSCRIPTIONS_STRIPE_"',
		));
	});
});
