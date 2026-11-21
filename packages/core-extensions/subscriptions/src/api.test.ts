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
			'subscriptions-cli',
			'subscriptions-sync',
			'subscriptions',
		]);
	});
});
