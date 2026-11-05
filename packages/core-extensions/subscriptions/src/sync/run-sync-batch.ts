import type { AbstractService } from '@directus/types';
import type { Knex } from 'knex';
import { findProvider } from '../providers/create-providers.js';
import type { SubscriptionProviders } from '../providers/types.js';
import { selectDueSync, type SyncQueueRow } from '../queue/sync-queue.js';
import { syncSubscription } from './sync-subscription.js';

export const SYNC_BATCH_LIMIT = 50;

const FIRST_RETRY_DELAY_MS = 60_000;

const LONGEST_RETRY_DELAY_MS = 3_600_000;

export type SyncBatchContext = {
	database: Knex;
	enabledProviders: SubscriptionProviders;
	createAccessService: (trx: Knex) => AbstractService;
	logger: { warn: (message: string) => void };
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

			const providerSubscription = await findProvider(
				enabledProviders,
				claimedRow.provider,
			)
				.fetchSubscription(claimedRow.resource_id);

			await syncSubscription({
				trx,
				accessService: createAccessService(trx),
				providerName: claimedRow.provider,
				providerSubscription,
				syncedAt: new Date(),
			});

			await trx('subscription_sync_queue')
				.where('id', claimedRow.id)
				.update({ pending: false, attempts: 0, last_error: null });
		});
	}
	catch (error) {
		const failedRow = syncClaim.claimedRow;

		if (failedRow === undefined) {
			throw error;
		}

		await recordSyncFailure(database, failedRow, error);

		logger.warn(
			`Subscription sync of ${JSON.stringify(failedRow.provider)}`
			+ ` ${JSON.stringify(failedRow.resource_id)} failed, attempt`
			+ ` ${JSON.stringify(failedRow.attempts + 1)}:`
			+ ` ${JSON.stringify(readErrorMessage(error))}`,
		);
	}

	return syncClaim.claimedRow === undefined;
}

async function recordSyncFailure(
	database: Knex,
	failedRow: SyncQueueRow,
	syncError: unknown,
): Promise<void> {
	await database('subscription_sync_queue')
		.where('id', failedRow.id)
		.update({
			attempts: failedRow.attempts + 1,
			next_attempt_at: new Date(Date.now() + Math.min(
				FIRST_RETRY_DELAY_MS * 2 ** failedRow.attempts,
				LONGEST_RETRY_DELAY_MS,
			)),
			last_error: readErrorMessage(syncError),
		});
}

function readErrorMessage(syncError: unknown): string {
	return syncError instanceof Error
		? syncError.message
		: JSON.stringify(syncError);
}
