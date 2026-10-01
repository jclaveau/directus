import { oneLine } from '@directus/utils';
import knex from 'knex';
import { MockClient, createTracker } from 'knex-mock-client';
import { describe, expect, it, vi } from 'vitest';
import { useLogger } from '../logger/index.js';
import { queueAfterCommit, transaction } from './transaction.js';

vi.mock('../database/index.js', () => {
	return { getDatabaseClient: vi.fn(() => 'sqlite') };
});

vi.mock('../logger/index.js', () => {
	const logger = { error: vi.fn(), trace: vi.fn() };

	return { useLogger: vi.fn(() => logger) };
});

describe('queueAfterCommit', () => {
	it(oneLine`
		hands a queued task the connection the transaction was opened on
	`, async () => {
		const db = knex.default({ client: MockClient });

		createTracker(db);

		const queuedTask = vi.fn(async () => {});

		await transaction(db, async (trx) => {
			queueAfterCommit(trx, queuedTask);
		});

		expect(queuedTask).toHaveBeenCalledWith(db);
	});

	it('runs a task queued on the trx once that trx committed', async () => {
		const db = knex.default({ client: MockClient });

		createTracker(db);

		const trxCompletedWhenRun = vi.fn();

		await transaction(db, async (trx) => {
			queueAfterCommit(trx, async () => {
				trxCompletedWhenRun((trx as knex.Knex.Transaction).isCompleted());
			});

			expect(trxCompletedWhenRun).not.toHaveBeenCalled();
		});

		expect(trxCompletedWhenRun).toHaveBeenCalledWith(true);
	});

	it(oneLine`
		runs a task queued from a nested transaction() once the outer one
		committed
	`, async () => {
		const db = knex.default({ client: MockClient });

		createTracker(db);

		const queuedTask = vi.fn(async () => {});

		await transaction(db, async (trx) => {
			await transaction(trx, async (nestedTrx) => {
				queueAfterCommit(nestedTrx, queuedTask);
			});

			expect(queuedTask).not.toHaveBeenCalled();
		});

		expect(queuedTask).toHaveBeenCalledOnce();
	});

	it('queues nothing on a knex that transaction() did not open', () => {
		const db = knex.default({ client: MockClient });

		createTracker(db);

		const queuedTask = vi.fn(async () => {});

		expect(queueAfterCommit(db, queuedTask)).toBe(false);
		expect(queuedTask).not.toHaveBeenCalled();
	});

	it('drops the tasks of a rolled-back transaction', async () => {
		const db = knex.default({ client: MockClient });

		createTracker(db);

		const queuedTask = vi.fn(async () => {});

		await expect(transaction(db, async (trx) => {
			queueAfterCommit(trx, queuedTask);

			throw new Error('write failed');
		})).rejects.toThrow('write failed');

		expect(queuedTask).not.toHaveBeenCalled();
	});

	it('runs only the tasks of the attempt that committed on a retry', async () => {
		const db = knex.default({ client: MockClient });

		createTracker(db);

		const abortedTask = vi.fn(async () => {});
		const committedTask = vi.fn(async () => {});

		await transaction(db, vi.fn()
			.mockImplementationOnce(async (trx) => {
				queueAfterCommit(trx, abortedTask);

				throw Object.assign(new Error('busy'), { code: 'SQLITE_BUSY' });
			})
			.mockImplementationOnce(async (trx) => {
				queueAfterCommit(trx, committedTask);
			}));

		expect(abortedTask).not.toHaveBeenCalled();
		expect(committedTask).toHaveBeenCalledOnce();
	});

	it(oneLine`
		runs every task, logs a failure and returns the committed result, without
		re-running the write even when the failure carries a retry code
	`, async () => {
		const db = knex.default({ client: MockClient });

		createTracker(db);

		const taskFailure = Object.assign(new Error('record failed'), {
			code: 'SQLITE_BUSY',
		});

		const secondTask = vi.fn(async () => {});

		const handler = vi.fn(async (trx: knex.Knex) => {
			queueAfterCommit(trx, async () => {
				throw taskFailure;
			});

			queueAfterCommit(trx, secondTask);

			return 'committed';
		});

		await expect(transaction(db, handler)).resolves.toBe('committed');

		expect(useLogger().error).toHaveBeenCalledWith(
			taskFailure,
			'[transaction] a task queued after commit failed: Error: record failed',
		);

		expect(secondTask).toHaveBeenCalledOnce();
		expect(handler).toHaveBeenCalledOnce();
	});
});
