import knex from 'knex';
import type { Keyv } from 'keyv';
import { MockClient, createTracker } from 'knex-mock-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearSystemCache } from '../cache.js';
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
});

describe('flushResponseCacheAfterCommit', () => {
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
