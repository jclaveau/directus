import type { Knex } from 'knex';
import { describe, expect, it } from 'vitest';
import {
	drainQueuedScopedCachePurges,
	readRequestScopedCachePurges,
	recordQueuedScopedCachePurges,
	recordScopedCachePurged,
} from './purged-record.js';
import { requestStore } from '../utils/request-store.js';

describe('readRequestScopedCachePurges', () => {
	it('refuses to read outside a request', async () => {
		await expect(readRequestScopedCachePurges()).rejects.toThrow(
			new Error(
				'readRequestPurges() was called outside a request: '
					+ 'no purged list to read',
			),
		);
	});

	it('answers a copy the purges after the read do not reach', async () => {
		const requestPurges = await requestStore.run(
			{ scopedCachePurged: { purged: [], queuedPurges: [] } },
			async () => {
				recordScopedCachePurged([{ collection: 'rounds' }]);

				const readPurges = await readRequestScopedCachePurges();

				recordScopedCachePurged([{ collection: 'courses' }]);

				return readPurges;
			},
		);

		expect(requestPurges).toEqual([{ collection: 'rounds' }]);
	});

	it('answers null once a purge flushed the whole namespace', async () => {
		const requestPurges = await requestStore.run(
			{ scopedCachePurged: { purged: [], queuedPurges: [] } },
			async () => {
				recordScopedCachePurged([{ collection: 'rounds' }]);
				recordScopedCachePurged(null);
				recordScopedCachePurged([{ collection: 'courses' }]);

				return readRequestScopedCachePurges();
			},
		);

		expect(requestPurges).toBeNull();
	});

	it(
		'waits for the purges queued on a settled transaction, and theirs',
		async () => {
			const settledTransaction = {
				isCompleted: () => true,
			} as Knex.Transaction;

			const requestPurges = await requestStore.run(
				{ scopedCachePurged: { purged: [], queuedPurges: [] } },
				async () => {
					recordQueuedScopedCachePurges(
						settledTransaction,
						new Promise<void>((resolve) => setTimeout(resolve, 10))
							.then(() => {
								recordScopedCachePurged([{ collection: 'rounds' }]);

								recordQueuedScopedCachePurges(
									settledTransaction,
									new Promise<void>((resolve) => setTimeout(resolve, 10))
										.then(() => {
											recordScopedCachePurged([{ collection: 'courses' }]);
										}),
								);
							}),
					);

					return readRequestScopedCachePurges();
				},
			);

			expect(requestPurges).toEqual([
				{ collection: 'rounds' },
				{ collection: 'courses' },
			]);
		},
	);

	it(
		'lets two reads of one request both wait for a settled transaction',
		async () => {
			const settledTransaction = {
				isCompleted: () => true,
			} as Knex.Transaction;

			const requestPurges = await requestStore.run(
				{ scopedCachePurged: { purged: [], queuedPurges: [] } },
				async () => {
					recordQueuedScopedCachePurges(
						settledTransaction,
						new Promise<void>((resolve) => setTimeout(resolve, 10))
							.then(() => {
								recordScopedCachePurged([{ collection: 'rounds' }]);
							}),
					);

					return Promise.all([
						readRequestScopedCachePurges(),
						readRequestScopedCachePurges(),
					]);
				},
			);

			expect(requestPurges).toEqual([
				[{ collection: 'rounds' }],
				[{ collection: 'rounds' }],
			]);
		},
	);

	it(
		'answers a read made by the purges a settled transaction queued',
		async () => {
			const settledTransaction = {
				isCompleted: () => true,
			} as Knex.Transaction;

			let purgesReadWhileDraining:
				| Awaited<ReturnType<typeof readRequestScopedCachePurges>>
				| undefined;

			await requestStore.run(
				{ scopedCachePurged: { purged: [], queuedPurges: [] } },
				async () => {
					const queuedPurgesRan = drainQueuedScopedCachePurges(
						settledTransaction,
						async () => {
							await new Promise((resolve) => setTimeout(resolve, 10));
							recordScopedCachePurged([{ collection: 'rounds' }]);
							purgesReadWhileDraining = await readRequestScopedCachePurges();
						},
					);

					recordQueuedScopedCachePurges(settledTransaction, queuedPurgesRan);

					await queuedPurgesRan;
				},
			);

			expect(purgesReadWhileDraining).toEqual([{ collection: 'rounds' }]);
		},
	);

	it('lets go of a transaction once its queued purges ran', async () => {
		const openTransaction = {
			isCompleted: () => false,
		} as Knex.Transaction;

		const purgedRecord = { purged: [], queuedPurges: [] };

		await requestStore.run({ scopedCachePurged: purgedRecord }, async () => {
			recordQueuedScopedCachePurges(openTransaction, Promise.resolve());

			await new Promise((resolve) => setTimeout(resolve, 0));
		});

		expect(purgedRecord.queuedPurges).toEqual([]);
	});

	it(
		'does not wait for a transaction still open around the read',
		async () => {
			const openTransaction = {
				isCompleted: () => false,
			} as Knex.Transaction;

			const requestPurges = await requestStore.run(
				{ scopedCachePurged: { purged: [], queuedPurges: [] } },
				async () => {
					recordQueuedScopedCachePurges(
						openTransaction,
						new Promise<void>(() => {}),
					);

					return readRequestScopedCachePurges();
				},
			);

			expect(requestPurges).toEqual([]);
		},
	);
});
