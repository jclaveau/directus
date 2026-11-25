import knex from 'knex';
import type { Keyv } from 'keyv';
import { MockClient, createTracker } from 'knex-mock-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearSystemCache } from '../cache.js';
import { useLogger } from '../logger/index.js';
import { flushResponseCache } from '../scoped-cache/index.js';
import { announceMembershipsChanged } from '../websocket/memberships-changed.js';
import {
	announceMembershipsChangedAfterCommit,
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

vi.mock('../websocket/memberships-changed.js', () => {
	return { announceMembershipsChanged: vi.fn() };
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

		expect(flushResponseCache).toHaveBeenCalledWith(responseCache, {
			permissionsCleared: true,
		});
	});

	it('leaves the response cache to a write that opted out', async () => {
		const onResponseCacheFlushDeferred = vi.fn();

		await clearCachesAfterCommit(
			knex.default({ client: MockClient }),
			{} as Keyv,
			{ autoPurgeCache: false, onResponseCacheFlushDeferred },
		);

		expect(clearSystemCache).toHaveBeenCalledWith({ autoPurgeCache: false });
		expect(flushResponseCache).not.toHaveBeenCalled();

		expect(onResponseCacheFlushDeferred).toHaveBeenCalledExactlyOnceWith({
			permissionsCleared: true,
		});
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

		expect(flushResponseCache).toHaveBeenCalledExactlyOnceWith(responseCache, {
			permissionsCleared: true,
		});
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

		expect(flushResponseCache).toHaveBeenCalledExactlyOnceWith(responseCache, {
			permissionsCleared: true,
		});
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

		expect(flushResponseCache).toHaveBeenCalledExactlyOnceWith(responseCache, {
			permissionsCleared: true,
		});
	});
});

describe('flushResponseCacheAfterCommit', () => {
	it('flushes once a trx opened elsewhere commits', async () => {
		const database = knex.default({ client: MockClient });
		const responseCache = {} as Keyv;

		createTracker(database);

		await database.transaction(async (trx) => {
			await flushResponseCacheAfterCommit(trx, responseCache, undefined, {
				permissionsCleared: false,
			});

			expect(flushResponseCache).not.toHaveBeenCalled();
		});

		await vi.waitFor(() => {
			expect(flushResponseCache).toHaveBeenCalledExactlyOnceWith(responseCache, {
				permissionsCleared: false,
			});
		});
	});

	it('logs a flush failing after a trx opened elsewhere', async () => {
		const database = knex.default({ client: MockClient });
		const flushError = new Error('Connection is closed.');

		createTracker(database);
		vi.mocked(flushResponseCache).mockRejectedValueOnce(flushError);

		await database.transaction(async (trx) => {
			await flushResponseCacheAfterCommit(trx, {} as Keyv, undefined, {
				permissionsCleared: false,
			});
		});

		await vi.waitFor(() => {
			expect(useLogger().error).toHaveBeenCalledExactlyOnceWith(
				flushError,
				'[cache] a flush held until a transaction settled failed: '
				+ 'Error: Connection is closed.',
			);
		});
	});

	// A membership write: the peers drop the roles before the responses.
	it('hands a write that opted out the permissions it cleared', async () => {
		const onResponseCacheFlushDeferred = vi.fn();

		await flushResponseCacheAfterCommit(
			knex.default({ client: MockClient }),
			{} as Keyv,
			{ autoPurgeCache: false, onResponseCacheFlushDeferred },
			{ permissionsCleared: true },
		);

		expect(flushResponseCache).not.toHaveBeenCalled();

		expect(onResponseCacheFlushDeferred).toHaveBeenCalledExactlyOnceWith({
			permissionsCleared: true,
		});
	});

	it('flushes nothing without a response cache', async () => {
		const onResponseCacheFlushDeferred = vi.fn();

		await flushResponseCacheAfterCommit(
			knex.default({ client: MockClient }),
			null,
			{ autoPurgeCache: false, onResponseCacheFlushDeferred },
			{ permissionsCleared: true },
		);

		expect(flushResponseCache).not.toHaveBeenCalled();
		expect(onResponseCacheFlushDeferred).not.toHaveBeenCalled();
	});
});

describe('announceMembershipsChangedAfterCommit', () => {
	it('refreshes the sockets at once outside a transaction', async () => {
		await announceMembershipsChangedAfterCommit(
			knex.default({ client: MockClient }),
			['user-id-1'],
		);

		expect(announceMembershipsChanged)
			.toHaveBeenCalledExactlyOnceWith(['user-id-1']);
	});

	it('refreshes the sockets once a trx opened elsewhere commits', async () => {
		const database = knex.default({ client: MockClient });

		createTracker(database);

		await database.transaction(async (trx) => {
			await announceMembershipsChangedAfterCommit(trx, ['user-id-2']);

			expect(announceMembershipsChanged).not.toHaveBeenCalled();
		});

		await vi.waitFor(() => {
			expect(announceMembershipsChanged)
				.toHaveBeenCalledExactlyOnceWith(['user-id-2']);
		});
	});
});
