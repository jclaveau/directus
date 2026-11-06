import type { AbstractService } from '@directus/types';
import type { Knex } from 'knex';
import { MissingProviderSubscriptionError } from '../errors.js';
import { findProvider } from '../providers/create-providers.js';
import type { SubscriptionProviders } from '../providers/types.js';
import {
	MAX_SYNC_ATTEMPTS,
	selectDueSync,
	type SyncQueueRow,
} from '../queue/sync-queue.js';
import { closeMissingSubscription, syncSubscription } from './sync-subscription.js';

export const SYNC_BATCH_LIMIT = 50;

const FIRST_RETRY_DELAY_MS = 60_000;

const LONGEST_RETRY_DELAY_MS = 3_600_000;

export type SyncBatchContext = {
	database: Knex;
	enabledProviders: SubscriptionProviders;
	createAccessService: (trx: Knex) => AbstractService;
	logger: {
		warn: (message: string) => void;
		error: (message: string) => void;
	};
};

/** Syncs due queue rows one transaction each; resolves to the rows claimed. */
export async function runSyncBatch(
	batchContext: SyncBatchContext,
): Promise<number> {
	for (let claimedCount = 0; claimedCount < SYNC_BATCH_LIMIT; claimedCount++) {
		const isQueueDrained = await syncNextRow(batchContext);

		if (isQueueDrained) {
			return claimedCount;
		}
	}

	return SYNC_BATCH_LIMIT;
}

async function syncNextRow({
	database,
	enabledProviders,
	createAccessService,
	logger,
}: SyncBatchContext): Promise<boolean> {
	const syncClaim: { claimedRow: SyncQueueRow | undefined } = {
		claimedRow: undefined,
	};

	try {
		await database.transaction(async (trx) => {
			const claimedRow = await selectDueSync(trx, new Date());
			syncClaim.claimedRow = claimedRow;

			if (claimedRow === undefined) {
				return;
			}

			const subscriptionProvider = findProvider(
				enabledProviders,
				claimedRow.provider,
			);

			const fetchedSubscription = await subscriptionProvider
				.fetchSubscription(claimedRow.resource_id)
				.catch((fetchError: unknown) => {
					if (fetchError instanceof MissingProviderSubscriptionError) {
						return fetchError;
					}

					throw fetchError;
				});

			const claimedQueueRow = trx('subscription_sync_queue')
				.where('id', claimedRow.id);

			if (fetchedSubscription instanceof MissingProviderSubscriptionError) {
				await closeMissingSubscription({
					trx,
					accessService: createAccessService(trx),
					providerName: claimedRow.provider,
					subscriptionId: fetchedSubscription.extensions.subscriptionId,
					closedAt: new Date(),
				});

				await claimedQueueRow.delete();

				logger.warn(
					`Subscription sync of ${JSON.stringify(claimedRow.provider)}`
					+ ` ${JSON.stringify(claimedRow.resource_id)} closed: the`
					+ ' provider has no such subscription',
				);

				return;
			}

			await syncSubscription({
				trx,
				accessService: createAccessService(trx),
				subscriptionProvider,
				providerName: claimedRow.provider,
				providerSubscription: fetchedSubscription,
				syncedAt: new Date(),
				logger,
			});

			const syncedResourceId = subscriptionProvider.composeResourceId({
				subscriptionId: fetchedSubscription.subscriptionId,
				customerId: fetchedSubscription.customerId,
			});

			// A Mollie webhook queues a payment id, which never comes up again.
			if (syncedResourceId !== claimedRow.resource_id) {
				await claimedQueueRow.delete();

				return;
			}

			await claimedQueueRow
				.update({ pending: false, attempts: 0, last_error: null });
		});
	}
	catch (error) {
		const failedRow = syncClaim.claimedRow;

		if (failedRow === undefined) {
			throw error;
		}

		const failedAttempts = failedRow.attempts + 1;
		const isParked = failedAttempts >= MAX_SYNC_ATTEMPTS;

		await recordSyncFailure(database, failedRow, error, isParked);

		const failureMessage = `Subscription sync of`
			+ ` ${JSON.stringify(failedRow.provider)}`
			+ ` ${JSON.stringify(failedRow.resource_id)} failed, attempt`
			+ ` ${JSON.stringify(failedAttempts)}:`
			+ ` ${JSON.stringify(readErrorMessage(error))}`;

		if (isParked) {
			logger.error(`${failureMessage}. No more retries until a webhook`);
		}
		else {
			logger.warn(failureMessage);
		}
	}

	return syncClaim.claimedRow === undefined;
}

async function recordSyncFailure(
	database: Knex,
	failedRow: SyncQueueRow,
	syncError: unknown,
	isParked: boolean,
): Promise<void> {
	const retriedAt = new Date(Date.now() + Math.min(
		FIRST_RETRY_DELAY_MS * 2 ** failedRow.attempts,
		LONGEST_RETRY_DELAY_MS,
	));

	await database('subscription_sync_queue')
		.where('id', failedRow.id)
		.update({
			attempts: failedRow.attempts + 1,
			// The rollback freed the row: a webhook may have set it due since the
			// claim, and that retry must not wait out this backoff.
			next_attempt_at: database.raw(
				'CASE WHEN next_attempt_at = ? THEN ? ELSE next_attempt_at END',
				[failedRow.next_attempt_at, retriedAt],
			),
			last_error: readErrorMessage(syncError),
			...isParked
				// TODO(#610): MariaDB's SET reads the next_attempt_at just written, so
				// there this always keeps the row pending.
				? {
					pending: database.raw(
						'CASE WHEN next_attempt_at = ? THEN ? ELSE pending END',
						[failedRow.next_attempt_at, false],
					),
				}
				: {},
		});
}

function readErrorMessage(syncError: unknown): string {
	if (syncError instanceof Error) {
		return syncError.message;
	}

	// A throw here would skip the backoff: the row would starve the queue.
	try {
		return JSON.stringify(syncError) ?? String(syncError);
	}
	catch {
		return String(syncError);
	}
}
