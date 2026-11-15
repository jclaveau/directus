import { InvalidPayloadError } from '@directus/errors';
import { describe, expect, test } from 'vitest';
import { readChosenSubscription } from './read-chosen-subscription.js';

describe('readChosenSubscription', () => {
	test.each([
		[{ subscription: 12 }, 12],
		[{}, undefined],
		[null, undefined],
		['12', undefined],
	])('reads %j as %j', (requestBody, expectedSubscription) => {
		expect(readChosenSubscription(requestBody)).toBe(expectedSubscription);
	});

	test.each([
		[{ subscription: '12' }, '"12"'],
		[{ subscription: 0 }, '0'],
		[{ subscription: 1.5 }, '1.5'],
		[{ subscription: null }, 'null'],
	])('refuses %j', (requestBody, reportedValue) => {
		expect(() => readChosenSubscription(requestBody))
			.toThrow(new InvalidPayloadError({
				reason: `"subscription" must be a subscription id, got ${reportedValue}`,
			}));
	});
});
