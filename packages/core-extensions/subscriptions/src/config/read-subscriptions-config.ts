export type SubscriptionsConfig = {
	stripe: { secretKey: string; webhookSecret: string } | null;
	mollie: { apiKey: string } | null;
};

export function readSubscriptionsConfig(
	env: Record<string, unknown>,
): SubscriptionsConfig {
	const stripeKey = readOptionalString(env, 'SUBSCRIPTIONS_STRIPE_SECRET_KEY');

	const stripeSecret = readOptionalString(
		env,
		'SUBSCRIPTIONS_STRIPE_WEBHOOK_SECRET',
	);

	const mollieKey = readOptionalString(env, 'SUBSCRIPTIONS_MOLLIE_API_KEY');

	if (stripeKey !== null && stripeSecret === null) {
		throw new Error(
			'"SUBSCRIPTIONS_STRIPE_WEBHOOK_SECRET" is required when'
			+ ' "SUBSCRIPTIONS_STRIPE_SECRET_KEY" is set',
		);
	}

	if (stripeKey === null && stripeSecret !== null) {
		throw new Error(
			'"SUBSCRIPTIONS_STRIPE_SECRET_KEY" is required when'
			+ ' "SUBSCRIPTIONS_STRIPE_WEBHOOK_SECRET" is set',
		);
	}

	return {
		stripe: stripeKey !== null && stripeSecret !== null
			? { secretKey: stripeKey, webhookSecret: stripeSecret }
			: null,
		mollie: mollieKey === null
? null
: { apiKey: mollieKey },
	};
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

	return variableValue;
}
