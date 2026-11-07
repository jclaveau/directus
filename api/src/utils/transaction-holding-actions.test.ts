import type { ActionEventParams } from '@directus/types';
import type { Knex } from 'knex';
import { describe, expect, it, vi } from 'vitest';
import { getDatabaseClient } from '../database/index.js';
import { transactionHoldingActions } from './transaction-holding-actions.js';

vi.mock('../database/index.js', () => {
	return {
		default: vi.fn(),
		getDatabaseClient: vi.fn().mockReturnValue('postgres'),
	};
});

const retryingKnex = {
	isTransaction: false,
	transaction: (handler: (trx: Knex) => Promise<unknown>) => {
		return handler({ isTransaction: true } as unknown as Knex);
	},
} as unknown as Knex;

describe('transactionHoldingActions', () => {
	it('keeps the events of the attempt that committed, and only those', async () => {
		vi.mocked(getDatabaseClient).mockReturnValueOnce('sqlite');

		const heldEvents: ActionEventParams[] = [];

		const runAttempt = vi.fn()
			.mockImplementationOnce(async () => {
				heldEvents.push({ event: 'aborted attempt' } as ActionEventParams);

				throw Object.assign(new Error('database is locked'), {
					code: 'SQLITE_BUSY',
				});
			})
			.mockImplementationOnce(async () => {
				heldEvents.push({ event: 'committed attempt' } as ActionEventParams);

				return 'answer';
			});

		await expect(
			transactionHoldingActions(retryingKnex, heldEvents, runAttempt),
		).resolves.toBe('answer');

		expect(heldEvents).toEqual([{ event: 'committed attempt' }]);
	});

	it('leaves no event held when the transaction fails', async () => {
		const heldEvents: ActionEventParams[] = [];

		await expect(
			transactionHoldingActions(retryingKnex, heldEvents, async () => {
				heldEvents.push({ event: 'rolled back' } as ActionEventParams);

				throw new Error('refused');
			}),
		).rejects.toEqual(new Error('refused'));

		expect(heldEvents).toEqual([]);
	});

	it('runs the retry callback of the transaction', async () => {
		vi.mocked(getDatabaseClient).mockReturnValueOnce('sqlite');

		const onRetry = vi.fn();

		const runAttempt = vi.fn()
			.mockRejectedValueOnce(Object.assign(new Error('database is locked'), {
				code: 'SQLITE_BUSY',
			}))
			.mockResolvedValueOnce('answer');

		await transactionHoldingActions(retryingKnex, [], runAttempt, onRetry);

		expect(onRetry).toHaveBeenCalledOnce();
	});
});
