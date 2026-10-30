import knex from 'knex';
import type { Keyv } from 'keyv';
import { MockClient, createTracker } from 'knex-mock-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearSystemCache } from '../cache.js';
import { useLogger } from '../logger/index.js';
import { flushResponseCache } from '../scoped-cache/index.js';
import {
	clearCachesAfterCommit,
	flushResponseCacheAfterCommit,
} from './clear-caches-after-commit.js';
import { transaction } from './transaction.js';

vi.mock('../database/index.js', () => {
	return {
		default: vi.fn(),
		getDatabaseClient: vi.fn().mockReturnValue('postgres'),
	};
});

vi.mock('../cache.js', () => {
	return { clearSystemCache: vi.fn() };
});

vi.mock('../scoped-cache/index.js', () => {
	return { flushResponseCache: vi.fn() };
});

vi.mock('../logger/index.js', () => {
	const logger = { error: vi.fn(), trace: vi.fn() };

	return { useLogger: vi.fn().mockReturnValue(logger) };
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('clearCachesAfterCommit', () => {
	it('clears both caches at once outside a transaction', async () => {
		const responseCache = {} as Keyv;

		await clearCachesAfterCommit(
			knex.default({ client: MockClient }),
			responseCache,
		);

		expect(clearSystemCache).toHaveBeenCalledWith({ autoPurgeCache: undefined });
		expect(flushResponseCache).toHaveBeenCalledWith(responseCache);
	});

	it('leaves the response cache to a write that opted out', async () => {
		await clearCachesAfterCommit(
			knex.default({ client: MockClient }),
			{} as Keyv,
			{ autoPurgeCache: false },
		);

		expect(clearSystemCache).toHaveBeenCalledWith({ autoPurgeCache: false });
		expect(flushResponseCache).not.toHaveBeenCalled();
	});

	it('clears both caches once the transaction rolls back', async () => {
		const database = knex.default({ client: MockClient });
		const responseCache = {} as Keyv;

		createTracker(database);

		await expect(transaction(database, async (trx) => {
			await clearCachesAfterCommit(trx, responseCache);

			throw new Error('write refused');
		})).rejects.toThrow('write refused');

		expect(clearSystemCache).toHaveBeenCalledExactlyOnceWith({
			autoPurgeCache: undefined,
		});

		expect(flushResponseCache).toHaveBeenCalledExactlyOnceWith(responseCache);
	});

	it('clears the caches once a trx opened elsewhere rolls back', async () => {
		const database = knex.default({ client: MockClient });
		const responseCache = {} as Keyv;

		createTracker(database);

		await expect(database.transaction(async (trx) => {
			await clearCachesAfterCommit(trx, responseCache);

			expect(clearSystemCache).not.toHaveBeenCalled();

			throw new Error('write refused');
		})).rejects.toThrow('write refused');

		await vi.waitFor(() => {
			expect(clearSystemCache).toHaveBeenCalledExactlyOnceWith({
				autoPurgeCache: undefined,
			});
		});

		expect(flushResponseCache).toHaveBeenCalledExactlyOnceWith(responseCache);
	});

	it('clears the caches once the trx a savepoint nests in commits', async () => {
		const database = knex.default({ client: MockClient });
		const responseCache = {} as Keyv;

		createTracker(database);

		await transaction(database, async (trx) => {
			await trx.transaction(async (savepoint) => {
				await clearCachesAfterCommit(savepoint, responseCache);
			});

			expect(clearSystemCache).not.toHaveBeenCalled();
		});

		expect(clearSystemCache).toHaveBeenCalledExactlyOnceWith({
			autoPurgeCache: undefined,
		});

		expect(flushResponseCache).toHaveBeenCalledExactlyOnceWith(responseCache);
	});
});

describe('flushResponseCacheAfterCommit', () => {
	it('flushes once a trx opened elsewhere commits', async () => {
		const database = knex.default({ client: MockClient });
		const responseCache = {} as Keyv;

		createTracker(database);

		await database.transaction(async (trx) => {
			await flushResponseCacheAfterCommit(trx, responseCache);

			expect(flushResponseCache).not.toHaveBeenCalled();
		});

		await vi.waitFor(() => {
			expect(flushResponseCache).toHaveBeenCalledExactlyOnceWith(responseCache);
		});
	});

	it('logs a flush failing after a trx opened elsewhere', async () => {
		const database = knex.default({ client: MockClient });
		const flushError = new Error('Connection is closed.');

		createTracker(database);
		vi.mocked(flushResponseCache).mockRejectedValueOnce(flushError);

		await database.transaction(async (trx) => {
			await flushResponseCacheAfterCommit(trx, {} as Keyv);
		});

		await vi.waitFor(() => {
			expect(useLogger().error).toHaveBeenCalledExactlyOnceWith(
				flushError,
				'[cache] a flush held until a transaction settled failed: '
				+ 'Error: Connection is closed.',
			);
		});
	});

	it('flushes nothing without a response cache', async () => {
		const onResponseCacheFlushDeferred = vi.fn();

		await flushResponseCacheAfterCommit(
			knex.default({ client: MockClient }),
			null,
			{ autoPurgeCache: false, onResponseCacheFlushDeferred },
		);

		expect(flushResponseCache).not.toHaveBeenCalled();
		expect(onResponseCacheFlushDeferred).not.toHaveBeenCalled();
	});
});
