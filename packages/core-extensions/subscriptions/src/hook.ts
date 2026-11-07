import { defineHook } from '@directus/extensions-sdk/scalabus';
import type {
	EventContext,
	ExtensionAccessCheck,
	PrimaryKey,
	UpdateEntries,
} from '@directus/types';
import { readSubscriptionsConfig } from './config/read-subscriptions-config.js';
import {
	refusePlanDelete,
	refusePlanStatusUpdate,
	refuseSubscriptionEventWrite,
	refuseSubscriptionStateUpdate,
	refuseUsedReferenceUpdate,
} from './plans/refuse-direct-writes.js';
import { createProviders } from './providers/create-providers.js';
import { enqueueReconcile } from './sync/enqueue-reconcile.js';
import { runSyncBatch } from './sync/run-sync-batch.js';
import {
	mountRawBody,
	readMaxPayloadSize,
} from './webhook/mount-raw-body.js';

export const SYNC_BATCH_CRON = '*/10 * * * * *';

export const RECONCILE_CRON = '0 * * * *';

type WriteFilterContext = Pick<
	EventContext,
	'accountability' | 'database' | 'schema'
>;

export const subscriptionsHook = defineHook(
	'subscriptions-sync',
	({ filter, init, schedule }, {
		env,
		database,
		services,
		getSchema,
		logger,
		validateAccess,
	}) => {
		const enabledProviders = createProviders(readSubscriptionsConfig(env));
		const maxPayloadSize = readMaxPayloadSize(env);

		init('middlewares.before', ({ app }) => {
			mountRawBody(app, maxPayloadSize);
		});

		// A filter runs before the write's own access check: without this, a caller
		// the write answers 403 would read the refusal, and which plan it names.
		async function validateWriteAccess(
			accessCheck: Omit<ExtensionAccessCheck, 'accountability'>,
			{ accountability, database: filterDatabase, schema }: WriteFilterContext,
		) {
			// No accountability: a service called without any, which checks nothing.
			if (accountability === null) {
				return;
			}

			await validateAccess(
				{ ...accessCheck, accountability },
				{ knex: filterDatabase, schema: schema! },
			);
		}

		async function validateUpdateAccess(
			collection: string,
			updateEntries: UpdateEntries,
			filterContext: WriteFilterContext,
		) {
			for (const updateEntry of updateEntries) {
				if ('data' in updateEntry) {
					await validateWriteAccess(
						{
							action: 'update',
							collection,
							primaryKeys: updateEntry.keys,
							fields: Object.keys(updateEntry.data),
						},
						filterContext,
					);
				}
			}
		}

		function refuseEventWriteAs(action: ExtensionAccessCheck['action']) {
			return async (
				_eventPayload: unknown,
				_eventMeta: unknown,
				filterContext: WriteFilterContext,
			): Promise<never> => {
				await validateWriteAccess(
					{ action, collection: 'subscription_events' },
					filterContext,
				);

				return refuseSubscriptionEventWrite();
			};
		}

		filter<PrimaryKey[]>(
			'subscription_plans.items.delete',
			async (planKeys, _eventMeta, filterContext) => {
				await validateWriteAccess(
					{
						action: 'delete',
						collection: 'subscription_plans',
						primaryKeys: planKeys,
					},
					filterContext,
				);

				return await refusePlanDelete(planKeys, filterContext.database);
			},
		);

		filter<UpdateEntries>(
			'subscription_plans.items.update',
			async (updateEntries, _eventMeta, filterContext) => {
				await validateUpdateAccess(
					'subscription_plans',
					updateEntries,
					filterContext,
				);

				return await refusePlanStatusUpdate(
					updateEntries,
					filterContext.database,
				);
			},
		);

		filter<UpdateEntries>(
			'subscription_plan_references.items.update',
			async (updateEntries, _eventMeta, filterContext) => {
				await validateUpdateAccess(
					'subscription_plan_references',
					updateEntries,
					filterContext,
				);

				return await refuseUsedReferenceUpdate(
					updateEntries,
					filterContext.database,
				);
			},
		);

		filter<UpdateEntries>(
			'subscriptions.items.update',
			async (updateEntries, _eventMeta, filterContext) => {
				await validateUpdateAccess(
					'subscriptions',
					updateEntries,
					filterContext,
				);

				return refuseSubscriptionStateUpdate(updateEntries);
			},
		);

		filter('subscription_events.items.create', refuseEventWriteAs('create'));
		filter('subscription_events.items.update', refuseEventWriteAs('update'));
		filter('subscription_events.items.delete', refuseEventWriteAs('delete'));

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
