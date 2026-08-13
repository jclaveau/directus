import type {
	PgBouncerClient,
	PgBouncerInstance,
	PgBouncerPool,
	PgBouncerReport,
	PgBouncerServer,
	PgBouncerStats,
} from '@directus/types';

/** Every server connection a pool holds, whatever each one is doing. */
export function serverConnections(pool: PgBouncerPool): number {
	return pool.serversActive
		+ pool.serversIdle
		+ pool.serversUsed
		+ pool.serversLogin;
}

/**
 * How much of a pool's server capacity is busy serving right now. `null` when
 * the database inherits the global `default_pool_size`, because the page cannot
 * claim a denominator it was not told.
 */
export function poolSaturation(pool: PgBouncerPool): number | null {
	if (pool.poolSize === null || pool.poolSize === 0) {
		return null;
	}

	return pool.serversActive / pool.poolSize;
}

/** Where a pool is close enough to its size to be worth flagging. */
export const POOL_SATURATION_WARNING_RATIO = 0.8;

export function isPoolNearCapacity(pool: PgBouncerPool): boolean {
	const saturation = poolSaturation(pool);

	return saturation !== null && saturation >= POOL_SATURATION_WARNING_RATIO;
}

/**
 * Whether clients are queueing on this pool. This is the state the whole page
 * exists for: past `query_wait_timeout` those clients are answered with an
 * error, so a waiting count is a countdown, not a load reading.
 */
export function isPoolQueueing(pool: PgBouncerPool): boolean {
	return pool.clientsWaiting > 0;
}

export function statsForDatabase(
	instance: PgBouncerInstance,
	database: string,
): PgBouncerStats | null {
	return instance.stats.find((row) => row.database === database) ?? null;
}

export function clientsOfPool(
	instance: PgBouncerInstance,
	pool: PgBouncerPool,
): PgBouncerClient[] {
	return instance.clients.filter((client) => {
		return client.database === pool.database;
	});
}

export function serversOfPool(
	instance: PgBouncerInstance,
	pool: PgBouncerPool,
): PgBouncerServer[] {
	return instance.servers.filter((server) => {
		return server.database === pool.database;
	});
}

export interface PgBouncerTotals {
	instances: number;
	unreachable: number;
	pools: number;
	clientsActive: number;
	clientsWaiting: number;
	serversActive: number;
	/** Summed `pool_size`, counting only the pools that carry one. */
	serverCapacity: number;
	maxWaitMs: number;
	queriesPerSecond: number;
	transactionsPerSecond: number;
}

function everyPool(report: PgBouncerReport): PgBouncerPool[] {
	return report.instances.flatMap((instance) => instance.pools);
}

/**
 * The header's reading of the whole fleet. The rates are pgbouncer's own
 * averages over its last stats period, not a difference between two polls —
 * a refresh interval the user picked must not change what a rate means.
 */
export function pgbouncerTotals(report: PgBouncerReport): PgBouncerTotals {
	const pools = everyPool(report);
	const stats = report.instances.flatMap((instance) => instance.stats);

	const sum = (values: number[]) => {
		return values.reduce((total, value) => total + value, 0);
	};

	return {
		instances: report.instances.length,
		unreachable: report.instances.filter((instance) => {
			return instance.reachable === false;
		}).length,
		pools: pools.length,
		clientsActive: sum(pools.map((pool) => pool.clientsActive)),
		clientsWaiting: sum(pools.map((pool) => pool.clientsWaiting)),
		serversActive: sum(pools.map((pool) => pool.serversActive)),
		serverCapacity: sum(pools.map((pool) => pool.poolSize ?? 0)),
		maxWaitMs: Math.max(0, ...pools.map((pool) => pool.maxWaitMs)),
		queriesPerSecond: sum(stats.map((row) => row.avgQueryCount)),
		transactionsPerSecond: sum(stats.map((row) => row.avgXactCount)),
	};
}

/** One polled reading of the fleet, as the chart plots it. */
export interface PgBouncerSample {
	at: number;
	clientsWaiting: number;
	serversActive: number;
	maxWaitMs: number;
}

/** How many readings the chart keeps; at 5s that is the last ten minutes. */
export const PGBOUNCER_SAMPLE_LIMIT = 120;

/**
 * Append a reading, dropping the oldest once the buffer is full. The samples
 * live for as long as the page is open — nothing persists them, so the chart
 * covers the visit rather than pretending to a history it does not have.
 */
export function appendSample(
	samples: PgBouncerSample[],
	report: PgBouncerReport,
): PgBouncerSample[] {
	const totals = pgbouncerTotals(report);

	const next = [...samples, {
		at: report.collectedAt,
		clientsWaiting: totals.clientsWaiting,
		serversActive: totals.serversActive,
		maxWaitMs: totals.maxWaitMs,
	}];

	return next.slice(-PGBOUNCER_SAMPLE_LIMIT);
}
