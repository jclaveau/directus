export type SubscriptionsConfig = {
	stripe: { secretKey: string; webhookSecret: string } | null;
	mollie: { apiKey: string; webhookSecret: string } | null;
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

	const mollieSecret = readOptionalString(
		env,
		'SUBSCRIPTIONS_MOLLIE_WEBHOOK_SECRET',
	);

	refuseLonePair(
		[stripeKey, 'SUBSCRIPTIONS_STRIPE_SECRET_KEY'],
		[stripeSecret, 'SUBSCRIPTIONS_STRIPE_WEBHOOK_SECRET'],
	);

	refuseLonePair(
		[mollieKey, 'SUBSCRIPTIONS_MOLLIE_API_KEY'],
		[mollieSecret, 'SUBSCRIPTIONS_MOLLIE_WEBHOOK_SECRET'],
	);

	return {
		stripe: stripeKey !== null && stripeSecret !== null
			? { secretKey: stripeKey, webhookSecret: stripeSecret }
			: null,
		mollie: mollieKey !== null && mollieSecret !== null
			? { apiKey: mollieKey, webhookSecret: mollieSecret }
			: null,
	};
}

export function readReconcileCron(env: Record<string, unknown>): string {
	return readOptionalString(env, 'SUBSCRIPTIONS_RECONCILE_CRON')
		?? DEFAULT_RECONCILE_CRON;
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
	// accepts: every call or webhook would fail long after the boot.
	if (variableValue.trim() !== variableValue) {
		throw new Error(
			`${JSON.stringify(variableName)} must not start or end with whitespace,`
			+ ` got ${JSON.stringify(variableValue)}`,
		);
	}

	return variableValue;
}
