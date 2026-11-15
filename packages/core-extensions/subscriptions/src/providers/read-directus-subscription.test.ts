import { describe, expect, test } from 'vitest';
import { readDirectusSubscription } from './read-directus-subscription.js';

describe('readDirectusSubscription', () => {
	test.each([
		[{ directus_subscription: '7' }, 7],
		[{ directus_subscription: '0' }, null],
		[{ directus_subscription: '07' }, null],
		[{ directus_subscription: '7.5' }, null],
		[{ directus_subscription: 7 }, null],
		[{}, null],
		[null, null],
		['7', null],
	])('reads %j as %j', (providerMetadata, expectedSubscription) => {
		expect(readDirectusSubscription(providerMetadata))
			.toBe(expectedSubscription);
	});
});
