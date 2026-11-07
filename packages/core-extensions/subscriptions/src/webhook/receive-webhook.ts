import type { IncomingHttpHeaders } from 'node:http';
import type { Knex } from 'knex';
import { WebhookIgnoredError } from '../errors.js';
import { findProvider } from '../providers/create-providers.js';
import type { SubscriptionProviders } from '../providers/types.js';
import { enqueueSync } from '../queue/sync-queue.js';

export type ReceivedWebhook = {
	database: Knex;
	enabledProviders: SubscriptionProviders;
	providerName: string;
	rawBody: Buffer;
	requestHeaders: IncomingHttpHeaders;
	logger: { warn: (message: string) => void };
};

/** Only queues the sync: the worker fetches the state the webhook hints at. */
export async function receiveWebhook({
	database,
	enabledProviders,
	providerName,
	rawBody,
	requestHeaders,
	logger,
}: ReceivedWebhook): Promise<void> {
	const webhookProvider = findProvider(enabledProviders, providerName);

	try {
		const resourceId = await webhookProvider
			.verifyWebhook(rawBody, requestHeaders);

		await enqueueSync(database, { provider: providerName, resourceId });
	}
	catch (error) {
		// Any answer but a 2xx has the provider retry what will never sync, then
		// disable the endpoint.
		if (!(error instanceof WebhookIgnoredError)) {
			throw error;
		}

		logger.warn(error.message);
	}
}
