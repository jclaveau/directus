const DIRECTUS_SUBSCRIPTION_ID = /^[1-9]\d*$/;

/** Provider metadata holds strings: the checkout wrote `subscriptions.id`. */
export function readDirectusSubscription(
	providerMetadata: unknown,
): number | null {
	if (typeof providerMetadata !== 'object' || providerMetadata === null) {
		return null;
	}

	const metadataValue = (providerMetadata as Record<string, unknown>)[
		'directus_subscription'
	];

	return typeof metadataValue === 'string'
		&& DIRECTUS_SUBSCRIPTION_ID.test(metadataValue)
		? Number(metadataValue)
		: null;
}
