import type { MollieRetrySettings } from '../providers/retry-mollie-calls.js';

export type SubscriptionsConfig = {
	stripe: { secretKey: string; webhookSecret: string } | null;
	mollie: {
		apiKey: string;
		webhookSecrets: string[];
		retry: MollieRetrySettings;
	} | null;
};

const DEFAULT_RECONCILE_CRON = '*/15 * * * *';

export function readSubscriptionsConfig(
	env: Record<string, unknown>,
): SubscriptionsConfig {
	const stripeKey = readOptionalString(env, 'SUBSCRIPTIONS_STRIPE_SECRET_KEY');

	const stripeSecret = readOptionalString(
		env,
		'SUBSCRIPTIONS_STRIPE_WEBHOOK_SECRET',
	);

	const mollieKey = readOptionalString(env, 'SUBSCRIPTIONS_MOLLIE_API_KEY');

	const mollieSecrets = readOptionalString(
		env,
		'SUBSCRIPTIONS_MOLLIE_WEBHOOK_SECRETS',
	);

	// Read even with Mollie off: a typo must not wait for Mollie to be enabled.
	const mollieRetry = {
		maxRetries: readRetrySetting(
			env,
			'SUBSCRIPTIONS_MOLLIE_RETRY_MAX_RETRIES',
			10,
			3,
		),
		delayMs: readRetrySetting(
			env,
			'SUBSCRIPTIONS_MOLLIE_RETRY_DELAY_MS',
			60_000,
			1000,
		),
	};

	refuseLonePair(
		[stripeKey, 'SUBSCRIPTIONS_STRIPE_SECRET_KEY'],
		[stripeSecret, 'SUBSCRIPTIONS_STRIPE_WEBHOOK_SECRET'],
	);

	refuseLonePair(
		[mollieKey, 'SUBSCRIPTIONS_MOLLIE_API_KEY'],
		[mollieSecrets, 'SUBSCRIPTIONS_MOLLIE_WEBHOOK_SECRETS'],
	);

	return {
		stripe: stripeKey !== null && stripeSecret !== null
			? { secretKey: stripeKey, webhookSecret: stripeSecret }
			: null,
		mollie: mollieKey !== null && mollieSecrets !== null
			? {
				apiKey: mollieKey,
				webhookSecrets: splitWebhookSecrets(
					mollieSecrets,
					'SUBSCRIPTIONS_MOLLIE_WEBHOOK_SECRETS',
				),
				retry: mollieRetry,
			}
			: null,
	};
}

/**
 * Mollie creates a webhook only for an organization access token, never an API
 * key: read by the webhook setup alone, the sync never needs it.
 */
export function readMollieAccessToken(env: Record<string, unknown>): string {
	const accessToken = readOptionalString(
		env,
		'SUBSCRIPTIONS_MOLLIE_ACCESS_TOKEN',
	);

	if (accessToken === null) {
		throw new Error(
			'"SUBSCRIPTIONS_MOLLIE_ACCESS_TOKEN" is required to create a Mollie'
			+ ' webhook: Mollie refuses an API key there',
		);
	}

	return accessToken;
}

export function readReconcileCron(env: Record<string, unknown>): string {
	return readOptionalString(env, 'SUBSCRIPTIONS_RECONCILE_CRON')
		?? DEFAULT_RECONCILE_CRON;
}

/**
 * A comma-separated list, so a rotated secret still verifies until it is
 * dropped. The error names the variable and the position, never a secret.
 */
function splitWebhookSecrets(
	listedSecrets: string,
	variableName: string,
): string[] {
	const webhookSecrets = listedSecrets
		.split(',')
		.map((listedSecret) => listedSecret.trim());

	const emptyIndex = webhookSecrets.indexOf('');

	if (emptyIndex !== -1) {
		throw new Error(
			`${JSON.stringify(variableName)} lists an empty secret`
			+ ` at position ${emptyIndex + 1}`,
		);
	}

	return webhookSecrets;
}

// A key without its webhook secret would sync nothing a webhook sends.
function refuseLonePair(
	[keyValue, keyVariable]: [string | null, string],
	[secretValue, secretVariable]: [string | null, string],
): void {
	if (keyValue !== null && secretValue === null) {
		throw new Error(
			`${JSON.stringify(secretVariable)} is required when`
			+ ` ${JSON.stringify(keyVariable)} is set`,
		);
	}

	if (keyValue === null && secretValue !== null) {
		throw new Error(
			`${JSON.stringify(keyVariable)} is required when`
			+ ` ${JSON.stringify(secretVariable)} is set`,
		);
	}
}

function readRetrySetting(
	env: Record<string, unknown>,
	variableName: string,
	maxValue: number,
	defaultValue: number,
): number {
	const settingValue = env[variableName];

	if (settingValue === undefined) {
		return defaultValue;
	}

	if (
		Number.isInteger(settingValue) === false
		|| (settingValue as number) < 0
		|| (settingValue as number) > maxValue
	) {
		throw new Error(
			`${JSON.stringify(variableName)} must be an integer from 0 to`
			+ ` ${maxValue}, got ${JSON.stringify(settingValue)}`,
		);
	}

	return settingValue as number;
}

function readOptionalString(
	env: Record<string, unknown>,
	variableName: string,
): string | null {
	const variableValue = env[variableName];

	if (variableValue === undefined) {
		return null;
	}

	if (typeof variableValue !== 'string' || variableValue === '') {
		throw new Error(
			`${JSON.stringify(variableName)} must be a non-empty string,`
			+ ` got ${JSON.stringify(variableValue)}`,
		);
	}

	// A `_FILE` secret keeps the file's trailing newline, which no provider
	// accepts: every call or webhook would fail long after the boot. The value
	// is a secret, so the message names the variable only.
	if (variableValue.trim() !== variableValue) {
		throw new Error(
			`${JSON.stringify(variableName)} must not start or end with whitespace`,
		);
	}

	return variableValue;
}
