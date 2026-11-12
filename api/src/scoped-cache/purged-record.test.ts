import type { Knex } from 'knex';
import { describe, expect, it } from 'vitest';
import {
	readRequestScopedCachePurges,
	recordQueuedScopedCachePurges,
	recordScopedCachePurged,
	scopedCachePurgedStore,
} from './purged-record.js';

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
		const requestPurges = await scopedCachePurgedStore.run(
			{ purged: [], queuedPurges: [] },
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
		const requestPurges = await scopedCachePurgedStore.run(
			{ purged: [], queuedPurges: [] },
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

			const requestPurges = await scopedCachePurgedStore.run(
				{ purged: [], queuedPurges: [] },
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
		'does not wait for a transaction still open around the read',
		async () => {
			const openTransaction = {
				isCompleted: () => false,
			} as Knex.Transaction;

			const requestPurges = await scopedCachePurgedStore.run(
				{ purged: [], queuedPurges: [] },
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
