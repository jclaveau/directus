import { expect, test } from 'vitest';
import { cast } from '../lib/cast.js';
import { isDirectusVariable } from '../utils/is-directus-variable.js';

test.each([
	'SUBSCRIPTIONS_STRIPE_SECRET_KEY_FILE',
	'SUBSCRIPTIONS_STRIPE_WEBHOOK_SECRET_FILE',
	'SUBSCRIPTIONS_MOLLIE_API_KEY_FILE',
	'SUBSCRIPTIONS_MOLLIE_WEBHOOK_SECRETS_FILE',
	'SUBSCRIPTIONS_MOLLIE_ACCESS_TOKEN_FILE',
	'SUBSCRIPTIONS_MOLLIE_RETRY_MAX_RETRIES_FILE',
	'SUBSCRIPTIONS_MOLLIE_RETRY_DELAY_MS_FILE',
])('reads %s', (fileVariable) => {
	expect(isDirectusVariable(fileVariable)).toBe(true);
});

// A number cast turns "" into 0 and "abc" into NaN: the bundle could not
// refuse the one or name the other.
test.each([
	['', ''],
	['abc', 'abc'],
	['3', 3],
	['0', 0],
])('keeps the Mollie retry setting %j as %j', (rawValue, castValue) => {
	expect(cast(rawValue, 'SUBSCRIPTIONS_MOLLIE_RETRY_MAX_RETRIES')).toBe(castValue);
});
