import { expect, test } from 'vitest';
import { isDirectusVariable } from '../utils/is-directus-variable.js';

test.each([
	'SUBSCRIPTIONS_STRIPE_SECRET_KEY_FILE',
	'SUBSCRIPTIONS_STRIPE_WEBHOOK_SECRET_FILE',
	'SUBSCRIPTIONS_MOLLIE_API_KEY_FILE',
	'SUBSCRIPTIONS_MOLLIE_WEBHOOK_SECRETS_FILE',
	'SUBSCRIPTIONS_MOLLIE_ACCESS_TOKEN_FILE',
])('reads %s', (fileVariable) => {
	expect(isDirectusVariable(fileVariable)).toBe(true);
});

