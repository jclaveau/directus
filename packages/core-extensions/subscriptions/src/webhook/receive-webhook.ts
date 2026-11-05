import type { IncomingHttpHeaders } from 'node:http';
import type { Knex } from 'knex';
import { findProvider } from '../providers/create-providers.js';
import type { SubscriptionProviders } from '../providers/types.js';
import { enqueueSync } from '../queue/sync-queue.js';

export type ReceivedWebhook = {
	database: Knex;
	enabledProviders: SubscriptionProviders;
	providerName: string;
	rawBody: Buffer;
	requestHeaders: IncomingHttpHeaders;
};

/** Only queues the sync: the worker fetches the state the webhook hints at. */
export async function receiveWebhook({
	database,
	enabledProviders,
	providerName,
	rawBody,
	requestHeaders,
}: ReceivedWebhook): Promise<void> {
	const resourceId = await findProvider(enabledProviders, providerName)
		.verifyWebhook(rawBody, requestHeaders);

	await enqueueSync(database, { provider: providerName, resourceId });
}
