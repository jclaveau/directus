import type { AbstractService } from '@directus/types';
import type { Knex } from 'knex';
import {
	MissingProviderSubscriptionError,
	UnboundProviderSubscriptionError,
} from '../errors.js';
import { findProvider } from '../providers/create-providers.js';
import type { SubscriptionProviders } from '../providers/types.js';
import {
	MAX_SYNC_ATTEMPTS,
	selectDueSync,
	type SyncQueueRow,
} from '../queue/sync-queue.js';
import {
	closeMissingSubscription,
	syncSubscription,
	type SyncedAccess,
	type SyncedSubscription,
} from './sync-subscription.js';

export const SYNC_BATCH_LIMIT = 50;

const FIRST_RETRY_DELAY_MS = 60_000;

const LONGEST_RETRY_DELAY_MS = 3_600_000;

/** Longer than any provider call; a dead worker's row waits this long. */
export const SYNC_LEASE_MS = 300_000;

/** The `subscriptions.synced` action's payload. */
export type SyncedAction = {
	subscription: number;
	provider: string;
	status: string;
} & SyncedAccess;

export type SyncBatchContext = {
	database: Knex;
	enabledProviders: SubscriptionProviders;
	createAccessService: (trx: Knex) => AbstractService;
	emitSyncedAction: (syncedAction: SyncedAction) => void;
	logger: {
		warn: (message: string) => void;
		error: (message: string) => void;
	};
};

/** Syncs due queue rows one lease each; resolves to the rows claimed. */
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
	emitSyncedAction,
	logger,
}: SyncBatchContext): Promise<boolean> {
	const leasedRow = await leaseDueSync(database);

	if (leasedRow === undefined) {
		return true;
	}

	let committedSync: SyncedSubscription | undefined;

	try {
		const subscriptionProvider = findProvider(
			enabledProviders,
			leasedRow.provider,
		);

		// No transaction open: a slow or throttled provider holds no connection.
		const fetchedSubscription = await subscriptionProvider
			.fetchSubscription(leasedRow.resource_id)
			.catch((fetchError: unknown) => {
				if (fetchError instanceof MissingProviderSubscriptionError) {
					return fetchError;
				}

				throw fetchError;
			});

		committedSync = await database.transaction(async (trx) => {
			const isLeaseHeld = await lockLeasedSync(trx, leasedRow);

			// A webhook re-armed the row or another worker took it over once the
			// lease ran out: the next claim fetches afresh.
			if (isLeaseHeld === false) {
				return undefined;
			}

			const leasedQueueRow = trx('subscription_sync_queue')
				.where('id', leasedRow.id);

			if (fetchedSubscription instanceof MissingProviderSubscriptionError) {
				const closedSubscription = await closeMissingSubscription({
					trx,
					accessService: createAccessService(trx),
					providerName: leasedRow.provider,
					subscriptionId: fetchedSubscription.extensions.subscriptionId,
					closedAt: new Date(),
				});

				await leasedQueueRow.delete();

				logger.warn(
					`Subscription sync of ${JSON.stringify(leasedRow.provider)}`
					+ ` ${JSON.stringify(leasedRow.resource_id)} closed: the`
					+ ' provider has no such subscription',
				);

				return closedSubscription;
			}

			let syncedSubscription: SyncedSubscription;

			try {
				syncedSubscription = await syncSubscription({
					trx,
					accessService: createAccessService(trx),
					subscriptionProvider,
					providerName: leasedRow.provider,
					providerSubscription: fetchedSubscription,
					syncedAt: new Date(),
					logger,
				});
			}
			catch (syncError) {
				if (!(syncError instanceof UnboundProviderSubscriptionError)) {
					throw syncError;
				}

				await leasedQueueRow.delete();

				logger.error(
					`Subscription sync of ${JSON.stringify(leasedRow.provider)}`
					+ ` ${JSON.stringify(leasedRow.resource_id)} dropped:`
					+ ` ${JSON.stringify(syncError.message)}`,
				);

				return undefined;
			}

			const syncedResourceId = subscriptionProvider.composeResourceId({
				subscriptionId: fetchedSubscription.subscriptionId,
				customerId: fetchedSubscription.customerId,
			});

			// A Mollie webhook queues a payment id, which never comes up again.
			if (syncedResourceId !== leasedRow.resource_id) {
				await leasedQueueRow.delete();
			}
			else {
				await leasedQueueRow
					.update({ pending: false, attempts: 0, last_error: null });
			}

			return syncedSubscription;
		});
	}
	catch (error) {
		const failedAttempts = leasedRow.attempts + 1;
		const isParked = failedAttempts >= MAX_SYNC_ATTEMPTS;

		await recordSyncFailure(database, leasedRow, error, isParked);

		const failureMessage = `Subscription sync of`
			+ ` ${JSON.stringify(leasedRow.provider)}`
			+ ` ${JSON.stringify(leasedRow.resource_id)} failed, attempt`
			+ ` ${JSON.stringify(failedAttempts)}:`
			+ ` ${JSON.stringify(readErrorMessage(error))}`;

		if (isParked) {
			logger.error(
				`${failureMessage}. Next try: the daily reconcile of a stored`
				+ ' subscription, or a webhook',
			);
		}
		else {
			logger.warn(failureMessage);
		}
	}

	// Past the commit and outside the try: a listener's throw is no sync failure.
	if (committedSync !== undefined) {
		emitSyncedAction({
			subscription: committedSync.subscription,
			provider: leasedRow.provider,
			status: committedSync.status,
			access: committedSync.access,
			granted: committedSync.granted,
			revoked: committedSync.revoked,
		});
	}

	return false;
}

/**
 * Pushes the due row's next try past the provider call, so no other worker
 * claims it meanwhile; a worker that dies mid-call leaves it due again once
 * the lease runs out.
 */
async function leaseDueSync(database: Knex): Promise<SyncQueueRow | undefined> {
	return database.transaction(async (trx) => {
		const dueRow = await selectDueSync(trx, new Date());

		if (dueRow === undefined) {
			return undefined;
		}

		const leasedUntil = new Date(Date.now() + SYNC_LEASE_MS);

		await trx('subscription_sync_queue')
			.where('id', dueRow.id)
			.update({ next_attempt_at: leasedUntil });

		return { ...dueRow, next_attempt_at: leasedUntil };
	});
}

/** Row locks only exist on PG; elsewhere the transaction serialises. */
async function lockLeasedSync(
	trx: Knex.Transaction,
	leasedRow: SyncQueueRow,
): Promise<boolean> {
	const leasedQuery = trx('subscription_sync_queue')
		.select('id')
		.where('id', leasedRow.id)
		.andWhere('next_attempt_at', leasedRow.next_attempt_at)
		.first();

	// TODO(#610): MariaDB 10.6+ also locks a row FOR UPDATE.
	if (trx.client.dialect === 'postgresql') {
		leasedQuery.forUpdate();
	}

	return (await leasedQuery) !== undefined;
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
			// A webhook may have set the row due since the lease, and that retry
			// must not wait out this backoff.
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
