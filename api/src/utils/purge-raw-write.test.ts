import type { SchemaOverview } from '@directus/types';
import { oneLine } from '@directus/utils';
import knex from 'knex';
import { MockClient, createTracker } from 'knex-mock-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLogger } from '../logger/index.js';
import { purgeRawWrite } from './purge-raw-write.js';
import { transaction } from './transaction.js';

const { purgeForMutatedRows } = vi.hoisted(() => {
	return { purgeForMutatedRows: vi.fn() };
});

vi.mock('../extensions/lib/scoped-cache-handle.js', () => {
	return {
		createScopedCacheExtensionHandle: () => ({ purgeForMutatedRows }),
	};
});

vi.mock('../database/index.js', () => {
	return { default: vi.fn(), getDatabaseClient: vi.fn(() => 'postgres') };
});

vi.mock('../logger/index.js', () => {
	const logger = { error: vi.fn(), trace: vi.fn() };

	return { useLogger: vi.fn(() => logger) };
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('purgeRawWrite', () => {
	it(oneLine`
		holds the purge until the transaction the write ran in committed, since a
		read before the commit would cache the old row again
	`, async () => {
		const db = knex.default({ client: MockClient });

		createTracker(db);

		await transaction(db, async (trx) => {
			await purgeRawWrite(
				trx,
				{} as SchemaOverview,
				'directus_users',
				[{ id: 'u-1' }],
			);

			expect(purgeForMutatedRows).not.toHaveBeenCalled();
		});

		expect(purgeForMutatedRows.mock.calls).toEqual([
			['directus_users', [{ id: 'u-1' }]],
		]);
	});

	it(oneLine`
		logs a failed purge rather than throwing it, since the write it follows has
		landed already
	`, async () => {
		const purgeError = new Error('Redis unreachable');

		purgeForMutatedRows.mockRejectedValueOnce(purgeError);

		await expect(purgeRawWrite(
			knex.default({ client: MockClient }),
			{} as SchemaOverview,
			'directus_users',
			[{ id: 'u-1' }],
		)).resolves.toBeUndefined();

		expect(vi.mocked(useLogger().error).mock.calls).toEqual([[
			purgeError,
			oneLine`
				[purge-raw-write] purging the rows a raw write left in directus_users
				failed: Error: Redis unreachable
			`,
		]]);
	});
});
