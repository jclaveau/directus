import { InvalidPayloadError } from '@directus/errors';

/** `{"subscription": 12}` picks one of the subscriptions the caller manages. */
export function readChosenSubscription(
	requestBody: unknown,
): number | undefined {
	const chosenSubscription = typeof requestBody === 'object'
		&& requestBody !== null
		? (requestBody as Record<string, unknown>)['subscription']
		: undefined;

	if (chosenSubscription === undefined) {
		return undefined;
	}

	if (!Number.isSafeInteger(chosenSubscription)
		|| (chosenSubscription as number) < 1) {
		throw new InvalidPayloadError({
			reason: `"subscription" must be a subscription id, got`
				+ ` ${JSON.stringify(chosenSubscription)}`,
		});
	}

	return chosenSubscription as number;
}
