import { describe, expect, test } from 'vitest';
import bundleApi from './api.js';

describe('bundle api', () => {
	test('declares the tables, the CLI, the sync hook and the endpoint', () => {
		expect(bundleApi.format).toBe('scalabus/1');

		expect(bundleApi.entries.map((bundleEntry) => bundleEntry.name)).toEqual([
			'20261105A-create-subscription-tables',
			'20261107A-create-parked-syncs-preset',
			'20261113A-show-subscription-collections',
			'20261121A-add-checkout-columns',
			'20261122A-create-invites-table',
			'20261123A-create-invoices-table',
			'subscriptions-cli',
			'subscriptions-sync',
			'subscriptions',
		]);
	});

	test('declares the subscriptions variables on every entry', () => {
		expect(bundleApi.entries.map((bundleEntry) => bundleEntry.env)).toEqual(
			Array(9).fill({
				prefix: 'SUBSCRIPTIONS_',
				vars: {
					SUBSCRIPTIONS_STRIPE_SECRET_KEY: { type: 'string' },
					SUBSCRIPTIONS_STRIPE_WEBHOOK_SECRET: { type: 'string' },
					SUBSCRIPTIONS_MOLLIE_API_KEY: { type: 'string' },
					SUBSCRIPTIONS_MOLLIE_WEBHOOK_SECRETS: { type: 'string' },
					SUBSCRIPTIONS_MOLLIE_ACCESS_TOKEN: { type: 'string' },
					SUBSCRIPTIONS_RECONCILE_CRON: { type: 'string' },
					SUBSCRIPTIONS_CHECKOUT_URL_ALLOW_LIST: { type: 'string[]' },
				},
			}),
		);
	});
});
