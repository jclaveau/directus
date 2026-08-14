import type {
	PgBouncerInstance,
	PgBouncerPool,
	PgBouncerReport,
} from '@directus/types';
import { expect, test } from 'vitest';
import {
	PGBOUNCER_SAMPLE_LIMIT,
	appendSample,
	clientsOfPool,
	isPoolNearCapacity,
	isPoolQueueing,
	pgbouncerTotals,
	poolSaturation,
	serverConnections,
	serversOfPool,
	statsForDatabase,
} from './pgbouncer-view';

function pool(overrides: Partial<PgBouncerPool> = {}): PgBouncerPool {
	return {
		database: 'directus_free',
		user: 'postgres',
		poolMode: 'transaction',
		clientsActive: 2,
		clientsWaiting: 0,
		serversActive: 1,
		serversIdle: 1,
		serversUsed: 0,
		serversLogin: 0,
		maxWaitMs: 0,
		poolSize: 4,
		reservePoolSize: null,
		paused: false,
		disabled: false,
		connections: ['free'],
		...overrides,
	};
}

function instance(
	overrides: Partial<PgBouncerInstance> = {},
): PgBouncerInstance {
	return {
		id: 'pgbouncer:6432',
		host: 'pgbouncer',
		port: 6432,
		connections: ['free', 'premium'],
		reachable: true,
		error: null,
		version: 'PgBouncer 1.25.2',
		pools: [pool()],
		clients: [],
		servers: [],
		stats: [],
		limits: [],
		...overrides,
	};
}

function report(instances: PgBouncerInstance[]): PgBouncerReport {
	return {
		collectedAt: 1_700_000_000_000,
		details: ['pools', 'stats', 'limits'],
		instances,
	};
}

test('A pool\'s server connections are all of them, whatever they do', () => {
	expect(serverConnections(pool({
		serversActive: 2,
		serversIdle: 3,
		serversUsed: 1,
		serversLogin: 1,
	}))).toBe(7);
});

test('Saturation is what is busy over the size, when there is a size', () => {
	expect(poolSaturation(pool({ serversActive: 1, poolSize: 4 }))).toBe(0.25);

	// An inherited size is no denominator, so the page claims none.
	expect(poolSaturation(pool({ poolSize: null }))).toBeNull();
	expect(poolSaturation(pool({ poolSize: 0 }))).toBeNull();
});

test('A pool close to its size is flagged, one with no size is not', () => {
	expect(isPoolNearCapacity(pool({ serversActive: 4, poolSize: 5 }))).toBe(true);
	expect(isPoolNearCapacity(pool({ serversActive: 3, poolSize: 5 }))).toBe(false);

	expect(isPoolNearCapacity(pool({ serversActive: 9, poolSize: null })))
		.toBe(false);
});

test('A pool with clients queueing is flagged whatever its size', () => {
	expect(isPoolQueueing(pool({ clientsWaiting: 1 }))).toBe(true);
	expect(isPoolQueueing(pool({ clientsWaiting: 0 }))).toBe(false);

	// Queueing without a known size still reads: it is the wait that matters.
	expect(isPoolQueueing(pool({ clientsWaiting: 4, poolSize: null }))).toBe(true);
});

test('The connections of a pool are the ones on its database', () => {
	const subject = instance({
		clients: [
			{
				database: 'directus_free',
				user: 'postgres',
				state: 'waiting',
				addr: '10.0.0.4',
				port: 5100,
				applicationName: 'directus:abc:free',
				waitMs: 900,
				connectedAt: '',
				tls: '',
				linked: false,
			},
			{
				database: 'directus_premium',
				user: 'postgres',
				state: 'active',
				addr: '10.0.0.4',
				port: 5101,
				applicationName: 'directus:abc:premium',
				waitMs: 0,
				connectedAt: '',
				tls: '',
				linked: true,
			},
		],
		servers: [
			{
				database: 'directus_premium',
				user: 'postgres',
				state: 'idle',
				addr: '10.0.0.3',
				port: 5432,
				connectedAt: '',
				tls: '',
				remotePid: 42,
			},
		],
	});

	expect(clientsOfPool(subject, pool()).map((client) => client.port))
		.toEqual([5100]);

	expect(serversOfPool(subject, pool())).toEqual([]);

	expect(serversOfPool(subject, pool({ database: 'directus_premium' })))
		.toHaveLength(1);
});

test('A database with no stats row reads as none, not as zero', () => {
	const subject = instance({
		stats: [{
			database: 'directus_free',
			totalXactCount: 10,
			totalQueryCount: 20,
			totalReceivedBytes: 0,
			totalSentBytes: 0,
			totalWaitTimeUs: 0,
			avgXactCount: 2,
			avgQueryCount: 4,
			avgQueryTimeUs: 0,
			avgWaitTimeUs: 0,
		}],
	});

	expect(statsForDatabase(subject, 'directus_free')?.avgQueryCount).toBe(4);
	expect(statsForDatabase(subject, 'directus_premium')).toBeNull();
});

test('Totals add up the fleet, and count what could not be read', () => {
	const totals = pgbouncerTotals(report([
		instance({
			pools: [
				pool({ clientsActive: 2, clientsWaiting: 3, maxWaitMs: 1200 }),
				pool({
					database: 'directus_premium',
					clientsActive: 5,
					serversActive: 2,
					poolSize: 20,
					maxWaitMs: 0,
				}),
			],
			stats: [{
				database: 'directus_free',
				totalXactCount: 0,
				totalQueryCount: 0,
				totalReceivedBytes: 0,
				totalSentBytes: 0,
				totalWaitTimeUs: 0,
				avgXactCount: 7,
				avgQueryCount: 12,
				avgQueryTimeUs: 0,
				avgWaitTimeUs: 0,
			}],
		}),
		instance({ id: 'pgb2:6432', reachable: false, pools: [], stats: [] }),
	]));

	expect(totals).toEqual({
		instances: 2,
		unreachable: 1,
		pools: 2,
		clientsActive: 7,
		clientsWaiting: 3,
		serversActive: 3,
		serverCapacity: 24,
		// The worst wait anywhere, not a sum of waits.
		maxWaitMs: 1200,
		queriesPerSecond: 12,
		transactionsPerSecond: 7,
	});
});

test('A fleet with no pool at all still totals to zero, not to -Infinity', () => {
	expect(pgbouncerTotals(report([instance({ pools: [] })])).maxWaitMs).toBe(0);
});

test('Samples accumulate while the page is open, then roll over', () => {
	const first = appendSample([], report([
		instance({ pools: [pool({ clientsWaiting: 2, maxWaitMs: 300 })] }),
	]));

	expect(first).toEqual([{
		at: 1_700_000_000_000,
		clientsWaiting: 2,
		serversActive: 1,
		maxWaitMs: 300,
	}]);

	const second = appendSample(first, report([instance()]));
	expect(second).toHaveLength(2);

	// The buffer is bounded, and it is the oldest reading that goes.
	const full = Array.from({ length: PGBOUNCER_SAMPLE_LIMIT }, (_unused, index) => {
		return {
			at: index,
			clientsWaiting: index,
			serversActive: 0,
			maxWaitMs: 0,
		};
	});

	const rolled = appendSample(full, report([instance()]));

	expect(rolled).toHaveLength(PGBOUNCER_SAMPLE_LIMIT);
	expect(rolled[0]!.at).toBe(1);
	expect(rolled.at(-1)!.at).toBe(1_700_000_000_000);
});
