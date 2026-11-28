import { defineEnv } from '@directus/extensions-sdk/scalabus';

/**
 * The variables the bundle reads, declared so a numeric-looking key stays a
 * string and the API checks them at boot.
 */
export const subscriptionsEnv = defineEnv({
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
});
