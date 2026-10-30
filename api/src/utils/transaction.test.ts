import { oneLine } from '@directus/utils';
import knex, { type Knex } from 'knex';
import { MockClient, createTracker } from 'knex-mock-client';
import { describe, expect, it, vi } from 'vitest';
import getDatabase from '../database/index.js';
import { useLogger } from '../logger/index.js';
import {
	queueAfterCommit,
	queueAfterCommitOrRollback,
	queueMergedAfterCommit,
	trackTransactionsOf,
	transaction,
} from './transaction.js';

vi.mock('../database/index.js', () => {
	return { default: vi.fn(), getDatabaseClient: vi.fn(() => 'sqlite') };
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

	it(oneLine`
		runs a task queued on a savepoint of the trx once the outer transaction
		committed
	`, async () => {
		const db = knex.default({ client: MockClient });

		createTracker(db);

		const queuedTask = vi.fn(async () => {});

		await transaction(db, async (trx) => {
			await trx.transaction(async (savepointTrx) => {
				expect(queueAfterCommit(savepointTrx, queuedTask)).toBe(true);
			});

			expect(queuedTask).not.toHaveBeenCalled();
		});

		expect(queuedTask).toHaveBeenCalledWith(db);
	});

	it(oneLine`
		runs a task queued on a rolled-back savepoint once the outer transaction
		committed
	`, async () => {
		const db = knex.default({ client: MockClient });

		createTracker(db);

		const queuedTask = vi.fn(async () => {});

		await transaction(db, async (trx) => {
			await expect(trx.transaction(async (savepointTrx) => {
				queueAfterCommit(savepointTrx, queuedTask);

				throw new Error('savepoint rolled back');
			})).rejects.toThrow('savepoint rolled back');
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

	it(oneLine`
		runs a task queued on a trx a raw database.transaction() opened once
		that trx committed
	`, async () => {
		const db = knex.default({ client: MockClient });

		createTracker(db);
		vi.mocked(getDatabase).mockReturnValue(db);

		const queuedTask = vi.fn(async () => {});

		await db.transaction(async (trx) => {
			expect(queueAfterCommit(trx, queuedTask)).toBe(true);
			expect(queuedTask).not.toHaveBeenCalled();
		});

		await vi.waitFor(() => expect(queuedTask).toHaveBeenCalledWith(db));
	});

	it(oneLine`
		runs a task queued on a savepoint of a raw trx once the raw trx
		committed
	`, async () => {
		const db = knex.default({ client: MockClient });

		createTracker(db);
		vi.mocked(getDatabase).mockReturnValue(db);

		const queuedTask = vi.fn(async () => {});

		await db.transaction(async (trx) => {
			await trx.transaction(async (savepointTrx) => {
				expect(queueAfterCommit(savepointTrx, queuedTask)).toBe(true);
			});

			expect(queuedTask).not.toHaveBeenCalled();
		});

		await vi.waitFor(() => expect(queuedTask).toHaveBeenCalledOnce());
	});

	it('drops the tasks of a raw trx its handler rolled back', async () => {
		const db = knex.default({ client: MockClient });

		createTracker(db);

		const queuedTask = vi.fn(async () => {});

		await expect(db.transaction(async (trx) => {
			expect(queueAfterCommit(trx, queuedTask)).toBe(true);

			throw new Error('write failed');
		})).rejects.toThrow('write failed');

		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(queuedTask).not.toHaveBeenCalled();
	});

	// Opened without a handler, a rolled-back trx resolves as a committed one
	// does: only the commit tells them apart.
	it('drops the tasks of a raw trx rolled back by hand', async () => {
		const db = knex.default({ client: MockClient });

		createTracker(db);

		const queuedTask = vi.fn(async () => {});
		const trx = await db.transaction();

		expect(queueAfterCommit(trx, queuedTask)).toBe(true);

		await trx.rollback();
		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(queuedTask).not.toHaveBeenCalled();
	});

	it('runs a task queued on a raw trx committed by hand', async () => {
		const db = knex.default({ client: MockClient });

		createTracker(db);
		vi.mocked(getDatabase).mockReturnValue(db);

		const queuedTask = vi.fn(async () => {});
		const trx = await db.transaction();

		expect(queueAfterCommit(trx, queuedTask)).toBe(true);

		await trx.commit();

		await vi.waitFor(() => expect(queuedTask).toHaveBeenCalledWith(db));
	});

	// A purge missed leaves the old row cached until TTL; one too many only
	// re-reads it.
	it(oneLine`
		runs a task queued on a raw trx committed through a commit taken before
		the task was queued
	`, async () => {
		const db = knex.default({ client: MockClient });

		createTracker(db);
		vi.mocked(getDatabase).mockReturnValue(db);

		const queuedTask = vi.fn(async () => {});
		const trx = await db.transaction();
		const { commit } = trx;

		expect(queueAfterCommit(trx, queuedTask)).toBe(true);

		await commit();

		await vi.waitFor(() => expect(queuedTask).toHaveBeenCalledWith(db));
	});

	it(oneLine`
		runs a task queued on a released savepoint of a raw trx once the raw trx
		committed
	`, async () => {
		const db = knex.default({ client: MockClient });

		createTracker(db);
		vi.mocked(getDatabase).mockReturnValue(db);

		const queuedTask = vi.fn(async () => {});

		await db.transaction(async (trx) => {
			const savepointTrx = await trx.transaction();

			await savepointTrx.commit();

			expect(queueAfterCommit(savepointTrx, queuedTask)).toBe(true);
		});

		await vi.waitFor(() => expect(queuedTask).toHaveBeenCalledOnce());
	});

	it('queues nothing on a raw trx that already committed', async () => {
		const db = knex.default({ client: MockClient });

		createTracker(db);

		const trx = await db.transaction();

		await trx.commit();

		expect(queueAfterCommit(trx, vi.fn())).toBe(false);
	});

	it('queues nothing on a trx that already committed', async () => {
		const db = knex.default({ client: MockClient });

		createTracker(db);

		const handler = vi.fn(async (_trx: knex.Knex) => {});

		await transaction(db, handler);

		expect(queueAfterCommit(handler.mock.calls[0]![0], vi.fn())).toBe(false);
	});

	it('runs the queued tasks one after another', async () => {
		const db = knex.default({ client: MockClient });

		createTracker(db);

		const taskSteps: string[] = [];

		await transaction(db, async (trx) => {
			queueAfterCommit(trx, async () => {
				taskSteps.push('first started');
				await new Promise((resolve) => setTimeout(resolve, 10));
				taskSteps.push('first ended');
			});

			queueAfterCommit(trx, async () => {
				taskSteps.push('second started');
			});
		});

		expect(taskSteps).toEqual(['first started', 'first ended', 'second started']);
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

	it('runs no task when every attempt failed', async () => {
		const db = knex.default({ client: MockClient });

		createTracker(db);

		const queuedTask = vi.fn(async () => {});

		await expect(transaction(db, async (trx) => {
			queueAfterCommit(trx, queuedTask);

			throw Object.assign(new Error('busy'), { code: 'SQLITE_BUSY' });
		})).rejects.toThrow('Transaction failed after 4 attempts');

		expect(queuedTask).not.toHaveBeenCalled();
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

describe('queueAfterCommitOrRollback', () => {
	it('runs a task queued on the trx once that trx rolled back', async () => {
		const db = knex.default({ client: MockClient });

		createTracker(db);

		const trxCompletedWhenRun = vi.fn();

		await expect(transaction(db, async (trx) => {
			queueAfterCommitOrRollback(trx, async (database) => {
				trxCompletedWhenRun(
					database,
					(trx as knex.Knex.Transaction).isCompleted(),
				);
			});

			throw new Error('write refused');
		})).rejects.toThrow('write refused');

		expect(trxCompletedWhenRun).toHaveBeenCalledWith(db, true);
	});

	it('runs a task queued on the trx once that trx committed', async () => {
		const db = knex.default({ client: MockClient });

		createTracker(db);

		const queuedTask = vi.fn(async () => {});

		await transaction(db, async (trx) => {
			queueAfterCommitOrRollback(trx, queuedTask);
		});

		expect(queuedTask).toHaveBeenCalledExactlyOnceWith(db);
	});

	it('runs the task of an aborted attempt, and of the one retried', async () => {
		const db = knex.default({ client: MockClient });

		createTracker(db);

		const queuedTask = vi.fn(async () => {});

		const handler = vi.fn()
			.mockImplementationOnce(async (trx: knex.Knex) => {
				queueAfterCommitOrRollback(trx, queuedTask);

				throw Object.assign(new Error('busy'), { code: 'SQLITE_BUSY' });
			})
			.mockImplementationOnce(async (trx: knex.Knex) => {
				queueAfterCommitOrRollback(trx, queuedTask);
			});

		await transaction(db, handler);

		expect(queuedTask).toHaveBeenCalledTimes(2);
	});

	it(oneLine`
		answers the rolled-back write's error when its task fails, logging the
		failure
	`, async () => {
		const db = knex.default({ client: MockClient });

		createTracker(db);

		const taskFailure = new Error('clear failed');

		await expect(transaction(db, async (trx) => {
			queueAfterCommitOrRollback(trx, async () => {
				throw taskFailure;
			});

			throw new Error('write refused');
		})).rejects.toThrow('write refused');

		expect(useLogger().error).toHaveBeenCalledWith(
			taskFailure,
			'[transaction] a task queued after rollback failed: Error: clear failed',
		);
	});

	it('leaves a task queued outside a transaction() trx to the caller', () => {
		const db = knex.default({ client: MockClient });

		expect(queueAfterCommitOrRollback(db, async () => {})).toBe(false);
	});
});

describe('queueMergedAfterCommit', () => {
	it(oneLine`
		runs the requests queued under one key as one merged request, in the place
		of the first
	`, async () => {
		const db = knex.default({ client: MockClient });

		createTracker(db);

		const taskSteps: string[] = [];

		const rowsMerger = {
			mergeRequests: (queued: string[], incoming: string[]) => {
				return [...queued, ...incoming];
			},
			runRequest: async (_database: Knex, request: string[]) => {
				taskSteps.push(`purge ${request.join(', ')}`);
			},
		};

		await transaction(db, async (trx) => {
			queueMergedAfterCommit(trx, 'rows', ['row 1'], rowsMerger);

			queueAfterCommit(trx, async () => {
				taskSteps.push('other task');
			});

			queueMergedAfterCommit(trx, 'rows', ['row 2'], rowsMerger);
		});

		expect(taskSteps).toEqual(['purge row 1, row 2', 'other task']);
	});

	it('merges the requests queued on a raw trx', async () => {
		const db = knex.default({ client: MockClient });

		createTracker(db);
		vi.mocked(getDatabase).mockReturnValue(db);

		const runRequest = vi.fn(async (_database: Knex, _request: string[]) => {});

		const rowsMerger = {
			mergeRequests: (queued: string[], incoming: string[]) => {
				return [...queued, ...incoming];
			},
			runRequest,
		};

		await db.transaction(async (trx) => {
			queueMergedAfterCommit(trx, 'rows', ['row 1'], rowsMerger);
			queueMergedAfterCommit(trx, 'rows', ['row 2'], rowsMerger);
		});

		await vi.waitFor(() => {
			expect(runRequest.mock.calls).toEqual([[db, ['row 1', 'row 2']]]);
		});
	});

	it(oneLine`
		runs apart the requests two callers queue under one key, each merged by its
		own function
	`, async () => {
		const db = knex.default({ client: MockClient });

		createTracker(db);

		const taskSteps: string[] = [];

		await transaction(db, async (trx) => {
			queueMergedAfterCommit(trx, 'rows', ['row 1'], {
				mergeRequests: (queued, incoming) => [...queued, ...incoming],
				runRequest: async (_database, request) => {
					taskSteps.push(`purge ${request.join(', ')}`);
				},
			});

			queueMergedAfterCommit(trx, 'rows', 1, {
				mergeRequests: (queued, incoming) => queued + incoming,
				runRequest: async (_database, request) => {
					taskSteps.push(`count ${request}`);
				},
			});
		});

		expect(taskSteps).toEqual(['purge row 1', 'count 1']);
	});

	it('runs the requests queued under different keys apart', async () => {
		const db = knex.default({ client: MockClient });

		createTracker(db);

		const runRequest = vi.fn(async () => {});

		await transaction(db, async (trx) => {
			queueMergedAfterCommit(trx, 'first', 'row 1', {
				mergeRequests: (queued) => queued,
				runRequest,
			});

			queueMergedAfterCommit(trx, 'second', 'row 2', {
				mergeRequests: (queued) => queued,
				runRequest,
			});
		});

		expect(runRequest.mock.calls).toEqual([[db, 'row 1'], [db, 'row 2']]);
	});

	it(oneLine`
		merges a request queued on a savepoint into the one its outer transaction
		holds
	`, async () => {
		const db = knex.default({ client: MockClient });

		createTracker(db);

		const runRequest = vi.fn(async () => {});

		const rowsMerger = {
			mergeRequests: (queued: string[], incoming: string[]) => {
				return [...queued, ...incoming];
			},
			runRequest,
		};

		await transaction(db, async (trx) => {
			queueMergedAfterCommit(trx, 'rows', ['row 1'], rowsMerger);

			await trx.transaction(async (savepointTrx) => {
				queueMergedAfterCommit(savepointTrx, 'rows', ['row 2'], rowsMerger);
			});
		});

		expect(runRequest.mock.calls).toEqual([[db, ['row 1', 'row 2']]]);
	});

	it('queues nothing on a knex that transaction() did not open', () => {
		const db = knex.default({ client: MockClient });

		createTracker(db);

		const runRequest = vi.fn(async () => {});

		expect(queueMergedAfterCommit(db, 'rows', 'row 1', {
			mergeRequests: (queued) => queued,
			runRequest,
		})).toBe(false);

		expect(runRequest).not.toHaveBeenCalled();
	});

	it(oneLine`
		merges nothing from an aborted attempt into the one that committed
	`, async () => {
		const db = knex.default({ client: MockClient });

		createTracker(db);

		const runRequest = vi.fn(async () => {});

		await transaction(db, vi.fn()
			.mockImplementationOnce(async (trx) => {
				queueMergedAfterCommit(trx, 'rows', ['aborted row'], {
					mergeRequests: (queued, incoming) => [...queued, ...incoming],
					runRequest,
				});

				throw Object.assign(new Error('busy'), { code: 'SQLITE_BUSY' });
			})
			.mockImplementationOnce(async (trx) => {
				queueMergedAfterCommit(trx, 'rows', ['committed row'], {
					mergeRequests: (queued, incoming) => [...queued, ...incoming],
					runRequest,
				});
			}));

		expect(runRequest.mock.calls).toEqual([[db, ['committed row']]]);
	});
});

describe('trackTransactionsOf', () => {
	it(oneLine`
		holds a task queued on a trx database.transaction(handler) opened until it
		commits
	`, async () => {
		const db = knex.default({ client: MockClient });

		createTracker(db);
		trackTransactionsOf(db);

		const trxCompletedWhenRun = vi.fn();

		await db.transaction(async (trx) => {
			queueAfterCommit(trx, async () => {
				trxCompletedWhenRun(trx.isCompleted());
			});
		});

		expect(trxCompletedWhenRun.mock.calls).toEqual([[true]]);
	});

	it('runs a task held for a rollback once the handler threw', async () => {
		const db = knex.default({ client: MockClient });

		createTracker(db);
		trackTransactionsOf(db);

		const queuedTask = vi.fn(async () => {});

		await expect(db.transaction(async (trx) => {
			queueAfterCommitOrRollback(trx, queuedTask);

			throw new Error('write failed');
		})).rejects.toThrow(new Error('write failed'));

		expect(queuedTask).toHaveBeenCalledOnce();
	});

	it('runs the handler once, a retry code included', async () => {
		const db = knex.default({ client: MockClient });

		createTracker(db);
		trackTransactionsOf(db);

		const busyError = Object.assign(new Error('busy'), { code: 'SQLITE_BUSY' });

		const handler = vi.fn(async () => {
			throw busyError;
		});

		await expect(db.transaction(handler)).rejects.toBe(busyError);

		expect(handler).toHaveBeenCalledOnce();
	});

	it('resolves to what the handler returned', async () => {
		const db = knex.default({ client: MockClient });

		createTracker(db);
		trackTransactionsOf(db);

		await expect(db.transaction(async () => 'committed'))
			.resolves.toBe('committed');
	});

	it(oneLine`
		holds a task queued on a trx database.transaction() opened until its
		commit() resolves
	`, async () => {
		const db = knex.default({ client: MockClient });

		createTracker(db);
		trackTransactionsOf(db);

		const queuedTask = vi.fn(async () => {});
		const trx = await db.transaction();

		queueAfterCommit(trx, queuedTask);

		expect(queuedTask).not.toHaveBeenCalled();

		await trx.commit();

		expect(queuedTask).toHaveBeenCalledOnce();
	});

	it(oneLine`
		runs only the tasks held for a rollback once rollback() resolves
	`, async () => {
		const db = knex.default({ client: MockClient });

		createTracker(db);
		trackTransactionsOf(db);

		const committedTask = vi.fn(async () => {});
		const settledTask = vi.fn(async () => {});
		const trx = await db.transaction();

		queueAfterCommit(trx, committedTask);
		queueAfterCommitOrRollback(trx, settledTask);

		await trx.rollback();

		expect(committedTask).not.toHaveBeenCalled();
		expect(settledTask).toHaveBeenCalledOnce();
	});

	it(oneLine`
		runs only the tasks held for a rollback once commit() resolves over a failed
		COMMIT
	`, async () => {
		const db = knex.default({ client: MockClient });

		createTracker(db);
		trackTransactionsOf(db);

		const committedTask = vi.fn(async () => {});
		const settledTask = vi.fn(async () => {});
		const trx = await db.transaction();

		const failingCommit = vi.spyOn(MockClient.prototype, '_query')
			.mockRejectedValueOnce(new Error('deferred check failed'));

		queueAfterCommit(trx, committedTask);
		queueAfterCommitOrRollback(trx, settledTask);

		await trx.commit();
		failingCommit.mockRestore();

		expect(committedTask).not.toHaveBeenCalled();
		expect(settledTask).toHaveBeenCalledOnce();
	});

	it(oneLine`
		holds a task queued on a trx database.transaction(config) opened
	`, async () => {
		const db = knex.default({ client: MockClient });

		createTracker(db);
		trackTransactionsOf(db);

		const queuedTask = vi.fn(async () => {});
		const trx = await db.transaction({ isolationLevel: 'serializable' });

		queueAfterCommit(trx, queuedTask);
		await trx.commit();

		expect(queuedTask).toHaveBeenCalledOnce();
	});

	it('holds a task queued on a trx transactionProvider() opened', async () => {
		const db = knex.default({ client: MockClient });

		createTracker(db);
		trackTransactionsOf(db);

		const queuedTask = vi.fn(async () => {});
		const trx = await db.transactionProvider()();

		queueAfterCommit(trx, queuedTask);
		await trx.commit();

		expect(queuedTask).toHaveBeenCalledOnce();
	});

	it('runs a task queued in transaction() on a tracked database once', async () => {
		const db = knex.default({ client: MockClient });

		createTracker(db);
		trackTransactionsOf(db);

		const queuedTask = vi.fn(async () => {});

		await transaction(db, async (trx) => {
			queueAfterCommit(trx, queuedTask);
		});

		expect(queuedTask).toHaveBeenCalledOnce();
	});

	it(oneLine`
		still retries the handler transaction() runs on a tracked database
	`, async () => {
		const db = knex.default({ client: MockClient });

		createTracker(db);
		trackTransactionsOf(db);

		const handler = vi.fn()
			.mockRejectedValueOnce(
				Object.assign(new Error('busy'), { code: 'SQLITE_BUSY' }),
			)
			.mockResolvedValueOnce('committed');

		await expect(transaction(db, handler)).resolves.toBe('committed');

		expect(handler).toHaveBeenCalledTimes(2);
	});
});
