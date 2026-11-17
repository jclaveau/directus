import { defineHook } from '@directus/extensions-sdk/scalabus';
import type {
	EventContext,
	ExtensionAccessCheck,
	PrimaryKey,
	UpdateEntries,
} from '@directus/types';
import {
	readReconcileCron,
	readSubscriptionsConfig,
} from './config/read-subscriptions-config.js';
import {
	revokeDeletedBeneficiaryAccesses,
} from './members/revoke-deleted-beneficiary-accesses.js';
import {
	refuseFrozenPlanUpdate,
	refuseLastManagerDelete,
	refuseLastManagerMove,
	refusePlanDelete,
	refusePlanStatusUpdate,
	refuseSubscriptionEventWrite,
	refuseSubscriptionStateUpdate,
} from './plans/refuse-direct-writes.js';
import { createProviders } from './providers/create-providers.js';
import type { SubscriptionProviders } from './providers/types.js';
import { enqueueReconcile } from './sync/enqueue-reconcile.js';
import { runSyncBatch } from './sync/run-sync-batch.js';
import {
	mountRawBody,
	readMaxPayloadSize,
} from './webhook/mount-raw-body.js';

export const SYNC_BATCH_CRON = '*/10 * * * * *';

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
		emitter,
	}) => {
		let enabledProviders: SubscriptionProviders | undefined;

		// Read at first use: the CLI loads this hook too, before
		// `subscriptions mollie-setup-webhook` has made the webhook secret a
		// Mollie key requires. The server refuses that env at boot already.
		const readEnabledProviders = (): SubscriptionProviders => {
			enabledProviders ??= createProviders(readSubscriptionsConfig(env));

			return enabledProviders;
		};

		const maxPayloadSize = readMaxPayloadSize(env);
		const reconcileCron = readReconcileCron(env);

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

				await refusePlanStatusUpdate(updateEntries, filterContext.database);

				return await refuseFrozenPlanUpdate(
					updateEntries,
					filterContext.database,
				);
			},
		);

		filter<PrimaryKey[]>(
			'subscription_managers.items.delete',
			async (managerKeys, _eventMeta, filterContext) => {
				await validateWriteAccess(
					{
						action: 'delete',
						collection: 'subscription_managers',
						primaryKeys: managerKeys,
					},
					filterContext,
				);

				return await refuseLastManagerDelete(
					managerKeys,
					filterContext.database,
				);
			},
		);

		filter<UpdateEntries>(
			'subscription_managers.items.update',
			async (updateEntries, _eventMeta, filterContext) => {
				await validateUpdateAccess(
					'subscription_managers',
					updateEntries,
					filterContext,
				);

				return await refuseLastManagerMove(
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

		// Before the rows go, in the delete's transaction: a beneficiary removed by
		// a request would otherwise keep the policy it no longer pays for.
		filter<PrimaryKey[]>(
			'subscription_beneficiaries.items.delete',
			async (beneficiaryKeys, _eventMeta, filterContext) => {
				await validateWriteAccess(
					{
						action: 'delete',
						collection: 'subscription_beneficiaries',
						primaryKeys: beneficiaryKeys,
					},
					filterContext,
				);

				await revokeDeletedBeneficiaryAccesses({
					trx: filterContext.database,
					accessService: new services.AccessService({
						knex: filterContext.database,
						schema: filterContext.schema!,
					}),
					beneficiaryKeys,
				});

				return beneficiaryKeys;
			},
		);

		schedule(SYNC_BATCH_CRON, async () => {
			const schemaOverview = await getSchema();

			await runSyncBatch({
				database,
				enabledProviders: readEnabledProviders(),
				logger,
				createAccessService: (trx) => {
					return new services.AccessService({
						knex: trx,
						schema: schemaOverview,
					});
				},
				// The extensions' own emitter, not the global one `action()` listens
				// on: a listener registers `emitter.onAction('subscriptions.synced')`.
				// A listener throwing synchronously rejects emitAction itself.
				emitSyncedAction: (syncedAction) => {
					emitter
						.emitAction('subscriptions.synced', syncedAction, {
							database,
							schema: schemaOverview,
							accountability: null,
						})
						.catch((listenerError: unknown) => {
							const listenerMessage = listenerError instanceof Error
								? listenerError.message
								: listenerError;

							logger.warn(
								'A "subscriptions.synced" listener threw:'
								+ ` ${JSON.stringify(listenerMessage)}`,
							);
						});
				},
			});
		});

		schedule(reconcileCron, async () => {
			await enqueueReconcile(database, readEnabledProviders());
		});
	},
);
