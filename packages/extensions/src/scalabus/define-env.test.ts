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

		const handler = () => null;

		const up = async () => {};

		const down = async () => {};

		const declaredEnv = { prefix: 'SUBSCRIPTIONS_', vars: subscriptionsVars };

		expect([
			subscriptionsEnv.defineHook('trials', hookConfig),
			subscriptionsEnv.defineEndpoint('checkout', endpointConfig),
			subscriptionsEnv.defineOperationApi('notify', { id: 'notify', handler }),
			subscriptionsEnv.defineMigration('20261124A-add-plans', { up, down }),
		]).toEqual([
			{ type: 'hook', name: 'trials', config: hookConfig, env: declaredEnv },
			{
				type: 'endpoint',
				name: 'checkout',
				config: endpointConfig,
				env: declaredEnv,
			},
			{
				type: 'operation',
				name: 'notify',
				config: { id: 'notify', handler },
				env: declaredEnv,
			},
			{
				type: 'migration',
				name: '20261124A-add-plans',
				config: { up, down, phase: 'before-schema' },
				env: declaredEnv,
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

	test('refuses a prefix that does not end with "_"', () => {
		expect(() => defineEnv({ prefix: 'SUBSCRIPTIONS', vars: {} }))
			.toThrow(new Error(
				'Env prefix "SUBSCRIPTIONS" must be upper case, with one "_" at its'
					+ ' end, like "SUBSCRIPTIONS_"',
			));
	});

	test('refuses a prefix with an inner "_"', () => {
		expect(() => defineEnv({ prefix: 'CACHE_ACME_', vars: {} }))
			.toThrow(new Error(
				'Env prefix "CACHE_ACME_" must be upper case, with one "_" at its'
					+ ' end, like "SUBSCRIPTIONS_"',
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
});
