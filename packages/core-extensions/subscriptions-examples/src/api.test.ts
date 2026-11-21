import { describe, expect, test } from 'vitest';
import bundleApi from './api.js';

describe('bundle api', () => {
	test('declares the seed migration and the pay page endpoint', () => {
		expect(bundleApi.entries.map((bundleEntry) => bundleEntry.name)).toEqual([
			'20261121A-seed-examples',
			'subscriptions-examples',
		]);
	});
});
