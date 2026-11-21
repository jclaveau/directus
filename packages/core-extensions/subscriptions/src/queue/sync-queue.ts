import type { Knex } from 'knex';

export type SyncQueueRow = {
	id: number;
	provider: string;
	resource_id: string;
	attempts: number;
	next_attempt_at: Date | number;
};

/**
 * About 2 days at the longest retry delay; the row then parks, until the reconcile
 * retries it daily or a webhook re-arms it. A row whose subscription was never
 * stored is not reconciled, so only a webhook does.
 */
export const MAX_SYNC_ATTEMPTS = 48;

export const PARKED_RETRY_DELAY_MS = 86_400_000;

export type SyncTarget = { provider: string; resourceId: string };

/** A new event brings the retry forward; the failure history stays on the row. */
export async function enqueueSync(
	database: Knex,
	syncTarget: SyncTarget,
): Promise<void> {
	await database('subscription_sync_queue')
		.insert({
			provider: syncTarget.provider,
			resource_id: syncTarget.resourceId,
			pending: true,
			attempts: 0,
			next_attempt_at: new Date(),
			last_error: null,
		})
		.onConflict(['provider', 'resource_id'])
		.merge(['pending', 'next_attempt_at']);
}

/** Row locks only exist on PG; elsewhere the transaction serialises. */
export function selectDueSync(
	trx: Knex,
	claimedAt: Date,
) {
	const dueQuery = trx<SyncQueueRow>('subscription_sync_queue')
		.select('id', 'provider', 'resource_id', 'attempts', 'next_attempt_at')
		.where('pending', true)
		.andWhere('next_attempt_at', '<=', claimedAt)
		.orderBy('next_attempt_at')
		.first();

	// TODO(#610): MariaDB 10.6+ also has SKIP LOCKED; SQLite has no row lock.
	if (trx.client.dialect === 'postgresql') {
		dueQuery.forUpdate()
			.skipLocked();
	}

	return dueQuery;
}
