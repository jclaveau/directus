// Where a Stripe or Mollie API call goes while the preview holds both the fake
// providers and the real test-mode ones.

export const PROVIDERS_MODES = ['fake', 'real'];

const REAL_PROVIDER_HOSTS = {
	'/v1/': 'https://api.stripe.com',
	'/v2/': 'https://api.mollie.com',
};

// A path naming an object, as `/v1/subscriptions/sub_1Qx` or
// `/v2/customers/cst_8wmq/subscriptions`: the object lives where it was made.
const NAMED_OBJECT = /\/[a-z]{2,4}_[A-Za-z0-9]+(?:\/|$)/;

/**
 * An object the fakes made carries `_examples_` in its id, and an object named
 * otherwise was made by the real provider: both stay where they live whatever
 * the mode is now. Only a call naming no object, a creation, follows the mode.
 */
export function pickProvidersTarget({
	requestPath,
	requestText,
	providersMode,
	isRealAvailable,
}) {
	if (`${requestPath} ${requestText ?? ''}`.includes('_examples_')) {
		return 'fake';
	}

	if (!isRealAvailable) {
		return 'fake';
	}

	if (NAMED_OBJECT.test(requestPath)) {
		return 'real';
	}

	return providersMode;
}

/** `https://api.stripe.com/v1/…` or `https://api.mollie.com/v2/…`. */
export function composeRealProviderUrl(requestUrl) {
	const providerPrefix = Object.keys(REAL_PROVIDER_HOSTS).find((apiPrefix) => {
		return requestUrl.startsWith(apiPrefix);
	});

	if (providerPrefix === undefined) {
		throw new Error(
			'The real providers answer /v1/ (Stripe) and /v2/ (Mollie), got'
			+ ` ${JSON.stringify(requestUrl)}`,
		);
	}

	return `${REAL_PROVIDER_HOSTS[providerPrefix]}${requestUrl}`;
}
