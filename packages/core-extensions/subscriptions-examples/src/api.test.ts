import { describe, expect, test } from 'vitest';
import bundleApi from './api.js';

describe('bundle api', () => {
	test('declares its two migrations and the pay page endpoint', () => {
		expect(bundleApi.entries.map((bundleEntry) => bundleEntry.name)).toEqual([
			'20261121A-seed-examples',
			'20261123A-show-examples-module',
			'subscriptions-examples',
		]);
	});
});
