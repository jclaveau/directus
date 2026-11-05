import { defineHook } from '@directus/extensions-sdk/scalabus';
import { readSubscriptionsConfig } from './config/read-subscriptions-config.js';
import { createProviders } from './providers/create-providers.js';
import { enqueueReconcile } from './sync/enqueue-reconcile.js';
import { runSyncBatch } from './sync/run-sync-batch.js';
import {
	mountRawBody,
	readMaxPayloadSize,
} from './webhook/mount-raw-body.js';

export const SYNC_BATCH_CRON = '*/10 * * * * *';

export const RECONCILE_CRON = '0 * * * *';

export const subscriptionsHook = defineHook(
	'subscriptions-sync',
	({ init, schedule }, { env, database, services, getSchema, logger }) => {
		const enabledProviders = createProviders(readSubscriptionsConfig(env));
		const maxPayloadSize = readMaxPayloadSize(env);

		init('middlewares.before', ({ app }) => {
			mountRawBody(app, maxPayloadSize);
		});

		schedule(SYNC_BATCH_CRON, async () => {
			const schemaOverview = await getSchema();

			await runSyncBatch({
				database,
				enabledProviders,
				logger,
				createAccessService: (trx) => {
					return new services.AccessService({
						knex: trx,
						schema: schemaOverview,
					});
				},
			});
		});

		schedule(RECONCILE_CRON, async () => {
			await enqueueReconcile(database, enabledProviders);
		});
	},
);
