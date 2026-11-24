import { ForbiddenError, InvalidPayloadError } from '@directus/errors';
import knex, { type Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { addCheckoutColumns } from '../migrations/add-checkout-columns.js';
import {
	createSubscriptionTables,
} from '../migrations/create-subscription-tables.js';
import type { SubscriptionProvider } from '../providers/types.js';
import { createCheckout } from './create-checkout.js';

let database: Knex;

beforeEach(async () => {
	database = knex({
		client: 'sqlite3',
		connection: { filename: ':memory:' },
		useNullAsDefault: true,
		pool: { min: 1, max: 1 },
	});

	await database.schema.createTable('directus_users', (table) => {
		table.uuid('id').primary();
		table.string('email');
	});

	await database('directus_users')
		.insert({ id: 'user-1', email: 'payer@example.com' });

	await createSubscriptionTables.config.up(database);
	await addCheckoutColumns.config.up(database);
	vi.useFakeTimers({ now: new Date('2026-11-05T00:00:00Z'), toFake: ['Date'] });

	await database('subscription_plans').insert([
		{
			code: 'pro',
			name: 'Pro',
			policy: 'policy-1',
			amount: 9.9,
			currency: 'eur',
			interval: '{"months":1}',
			beneficiaries_max: 3,
			status: 'active',
		},
		{
			code: 'old',
			name: 'Old',
			policy: 'policy-1',
			amount: 10,
			currency: 'EUR',
			interval: '{"months":1}',
			beneficiaries_max: 1,
			status: 'archived',
		},
		{
			code: 'locked',
			name: 'Locked',
			policy: 'policy-1',
			amount: 10,
			currency: 'EUR',
			interval: '{"months":1}',
			beneficiaries_max: 1,
			status: 'subscriptions-locked',
		},
	]);
});

afterEach(async () => {
	vi.useRealTimers();
	await database.destroy();
});

describe('createCheckout', () => {
	test('seats the payer on a pending row, then opens the page', async () => {
		const stripeCheckout = vi.fn()
			.mockResolvedValue({
				url: 'https://checkout.stripe.com/c/pay/cs_1',
				inPageRefusal: null,
			});

		await expect(createCheckout({
			database,
			enabledProviders: new Map([
				['stripe', {
					createCheckout: stripeCheckout,
				} as unknown as SubscriptionProvider],
			]),
			checkoutUrlAllowList: [new URL('https://shop.example.com/ok')],
			userId: 'user-1',
			logger: { warn: vi.fn() },
			requestBody: {
				plan: 'pro',
				provider: 'stripe',
				redirect_url: 'https://shop.example.com/ok?order=7',
			},
		})).resolves.toEqual({
			subscription: 1,
			url: 'https://checkout.stripe.com/c/pay/cs_1',
		});

		expect(stripeCheckout).toHaveBeenCalledWith({
			directusSubscription: 1,
			payerEmail: 'payer@example.com',
			amount: { currency: 'EUR', value: '9.90' },
			interval: { months: 1, days: 0 },
			planName: 'Pro',
			redirectUrl: 'https://shop.example.com/ok?order=7',
		});

		expect(await database('subscriptions')
			.select('id', 'plan', 'provider', 'status', 'payer', 'custom_amount'))
			.toEqual([{
				id: 1,
				plan: 1,
				provider: 'stripe',
				status: 'pending',
				payer: 'user-1',
				custom_amount: null,
			}]);

		expect(await database('subscription_managers')
			.select('subscription', 'user'))
			.toEqual([{ subscription: 1, user: 'user-1' }]);

		expect(await database('subscription_beneficiaries')
			.select('subscription', 'user'))
			.toEqual([{ subscription: 1, user: 'user-1' }]);
	});

	test('reuses the pending row of the same plan and provider', async () => {
		await database('subscriptions').insert([
			{
				plan: 1,
				provider: 'mollie',
				status: 'pending',
				payer: 'user-1',
				custom_amount: 20,
				date_created: new Date('2026-10-01T00:00:00Z'),
				date_updated: new Date('2026-10-01T00:00:00Z'),
			},
			{
				plan: 1,
				provider: 'mollie',
				status: 'pending',
				provider_subscription_id: 'sub_1',
				payer: 'user-1',
				date_created: new Date('2026-10-01T00:00:00Z'),
				date_updated: new Date('2026-10-01T00:00:00Z'),
			},
		]);

		const mollieCheckout = vi.fn()
			.mockResolvedValue({
				url: 'https://www.mollie.com/checkout/tr_1',
				inPageRefusal: null,
			});

		await expect(createCheckout({
			database,
			enabledProviders: new Map([
				['mollie', {
					createCheckout: mollieCheckout,
				} as unknown as SubscriptionProvider],
			]),
			checkoutUrlAllowList: [new URL('https://shop.example.com/ok')],
			userId: 'user-1',
			logger: { warn: vi.fn() },
			requestBody: {
				plan: 'pro',
				provider: 'mollie',
				custom_amount: '14.90',
				redirect_url: 'https://shop.example.com/ok',
			},
		})).resolves.toEqual({
			subscription: 1,
			url: 'https://www.mollie.com/checkout/tr_1',
		});

		expect(mollieCheckout).toHaveBeenCalledWith({
			directusSubscription: 1,
			payerEmail: 'payer@example.com',
			amount: { currency: 'EUR', value: '14.90' },
			interval: { months: 1, days: 0 },
			planName: 'Pro',
			redirectUrl: 'https://shop.example.com/ok',
		});

		expect(await database('subscriptions')
			.select('id', 'custom_amount', 'date_updated'))
			.toEqual([
				{ id: 1, custom_amount: 14.9, date_updated: 1_793_836_800_000 },
				{ id: 2, custom_amount: null, date_updated: 1_790_812_800_000 },
			]);

		expect(await database('subscription_managers')).toEqual([]);
	});

	test.each([
		['14.90', 14.9],
		['9.90', null],
	])('stores a custom_amount of %j as %j', async (customAmount, storedAmount) => {
		await createCheckout({
			database,
			enabledProviders: new Map([
				['stripe', {
					createCheckout: vi.fn().mockResolvedValue({
						url: 'https://pay',
						inPageRefusal: null,
					}),
				} as unknown as SubscriptionProvider],
			]),
			checkoutUrlAllowList: [new URL('https://shop.example.com/ok')],
			userId: 'user-1',
			logger: { warn: vi.fn() },
			requestBody: {
				plan: 'pro',
				provider: 'stripe',
				custom_amount: customAmount,
				redirect_url: 'https://shop.example.com/ok',
			},
		});

		expect(await database('subscriptions').select('custom_amount'))
			.toEqual([{ custom_amount: storedAmount }]);
	});

	test('hands the in-page form its client token', async () => {
		await expect(createCheckout({
			database,
			enabledProviders: new Map([
				['stripe', {
					createCheckout: vi.fn().mockResolvedValue({
						clientToken: 'cs_1_secret_2',
						publishableKey: 'pk_test_1',
					}),
				} as unknown as SubscriptionProvider],
			]),
			checkoutUrlAllowList: [new URL('https://shop.example.com/ok')],
			userId: 'user-1',
			logger: { warn: vi.fn() },
			requestBody: {
				plan: 'pro',
				provider: 'stripe',
				redirect_url: 'https://shop.example.com/ok',
			},
		})).resolves.toEqual({
			subscription: 1,
			client_token: 'cs_1_secret_2',
			publishable_key: 'pk_test_1',
		});
	});

	test('logs why the provider refused the in-page form', async () => {
		const checkoutLogger = { warn: vi.fn() };

		await expect(createCheckout({
			database,
			enabledProviders: new Map([
				['mollie', {
					createCheckout: vi.fn().mockResolvedValue({
						url: 'https://www.mollie.com/checkout/tr_1',
						inPageRefusal: 'Mollie answered 422 to a session: "Beta"',
					}),
				} as unknown as SubscriptionProvider],
			]),
			checkoutUrlAllowList: [new URL('https://shop.example.com/ok')],
			userId: 'user-1',
			logger: checkoutLogger,
			requestBody: {
				plan: 'pro',
				provider: 'mollie',
				redirect_url: 'https://shop.example.com/ok',
			},
		})).resolves.toEqual({
			subscription: 1,
			url: 'https://www.mollie.com/checkout/tr_1',
		});

		expect(checkoutLogger.warn).toHaveBeenCalledWith(
			'"mollie" refused the in-page checkout of subscription 1, sent to its'
			+ ' page instead: "Mollie answered 422 to a session: \\"Beta\\""',
		);
	});

	test('refuses the public', async () => {
		await expect(createCheckout({
			database,
			enabledProviders: new Map(),
			checkoutUrlAllowList: [],
			userId: null,
			logger: { warn: vi.fn() },
			requestBody: {},
		})).rejects.toThrow(new ForbiddenError());
	});

	test.each([
		[
			{ plan: 'pro', provider: 'paypal' },
			'"provider" must be one of ["mollie","stripe"], got "paypal"',
		],
		[
			{ plan: 'pro' },
			'"provider" must be one of ["mollie","stripe"], got null',
		],
		[
			{ plan: 'pro', provider: 'stripe', custom_amount: '14.9' },
			'"custom_amount" must be an amount like "14.90", got "14.9"',
		],
		[
			{ plan: 'pro', provider: 'stripe', custom_amount: 14.9 },
			'"custom_amount" must be an amount like "14.90", got 14.9',
		],
		[
			{
				plan: 'pro',
				provider: 'stripe',
				redirect_url: 'https://shop.example.com/other',
			},
			'URL "https://shop.example.com/other" can\'t be used to return from'
			+ ' a checkout',
		],
		[
			{
				plan: 'pro',
				provider: 'stripe',
				redirect_url: 'https://evil.example.com/ok',
			},
			'URL "https://evil.example.com/ok" can\'t be used to return from'
			+ ' a checkout',
		],
		[
			{ plan: 'pro', provider: 'stripe', redirect_url: 'not a url' },
			'URL "not a url" can\'t be used to return from a checkout',
		],
		[
			{ plan: 'pro', provider: 'stripe' },
			'URL null can\'t be used to return from a checkout',
		],
		[
			{
				plan: 'none',
				provider: 'stripe',
				redirect_url: 'https://shop.example.com/ok',
			},
			'Plan "none" does not exist',
		],
		[
			{ plan: 7, provider: 'stripe', redirect_url: 'https://shop.example.com/ok' },
			'Plan 7 does not exist',
		],
		[
			{ provider: 'stripe', redirect_url: 'https://shop.example.com/ok' },
			'Plan null does not exist',
		],
		[
			{
				plan: 'old',
				provider: 'stripe',
				redirect_url: 'https://shop.example.com/ok',
			},
			'Plan "old" is archived, it sells no more',
		],
		[
			{
				plan: 'locked',
				provider: 'stripe',
				redirect_url: 'https://shop.example.com/ok',
			},
			'Plan "locked" is "subscriptions-locked", it sells no more',
		],
		[
			{
				plan: 'pro',
				provider: 'stripe',
				custom_amount: '5.00',
				redirect_url: 'https://shop.example.com/ok',
			},
			'"custom_amount" must be at least "9.90", got "5.00"',
		],
	])('refuses %j, opening no page', async (requestBody, refusalReason) => {
		const stripeCheckout = vi.fn();

		await expect(createCheckout({
			database,
			enabledProviders: new Map([
				['stripe', {
					createCheckout: stripeCheckout,
				} as unknown as SubscriptionProvider],
				['mollie', {} as SubscriptionProvider],
			]),
			checkoutUrlAllowList: [new URL('https://shop.example.com/ok')],
			userId: 'user-1',
			logger: { warn: vi.fn() },
			requestBody,
		})).rejects.toThrow(new InvalidPayloadError({ reason: refusalReason }));

		expect(stripeCheckout).not.toHaveBeenCalled();
		expect(await database('subscriptions')).toEqual([]);
	});

	test('reads a body that is no object as an empty one', async () => {
		await expect(createCheckout({
			database,
			enabledProviders: new Map(),
			checkoutUrlAllowList: [],
			userId: 'user-1',
			logger: { warn: vi.fn() },
			requestBody: 'plan=pro',
		})).rejects.toThrow(new InvalidPayloadError({
			reason: '"provider" must be one of [], got null',
		}));
	});
});
