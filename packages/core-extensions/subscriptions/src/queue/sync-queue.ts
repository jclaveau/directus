import type { Knex } from 'knex';

export type SyncQueueRow = {
	id: number;
	provider: string;
	resource_id: string;
	attempts: number;
};

export type SyncTarget = { provider: string; resourceId: string };

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
		.merge(['pending', 'attempts', 'next_attempt_at', 'last_error']);
}

/** Row locks only exist on PG; elsewhere the transaction serialises. */
export function selectDueSync(
	trx: Knex,
	claimedAt: Date,
) {
	const dueQuery = trx<SyncQueueRow>('subscription_sync_queue')
		.select('id', 'provider', 'resource_id', 'attempts')
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
