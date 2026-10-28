import { ForbiddenError } from '@directus/errors';
import { SchemaBuilder } from '@directus/schema-builder';
import { oneLine } from '@directus/utils';
import type { Accountability } from '@directus/types';
import knex, { type Knex } from 'knex';
import { MockClient, Tracker, createTracker } from 'knex-mock-client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCache as clearPermissionsCache } from '../permissions/cache.js';
import { withMeta } from '../utils/read-meta.js';
import { ItemsService } from './items.js';
import type { EmailOptions } from './mail/index.js';
import { SharesService } from './shares.js';

vi.mock('../../src/database/index', () => ({
	default: vi.fn(),
	getDatabaseClient: vi.fn().mockReturnValue('postgres'),
}));

vi.mock('../permissions/cache.js', async (importOriginal) => {
	return {
		...await importOriginal<typeof import('../permissions/cache.js')>(),
		clearCache: vi.fn(),
	};
});

const { send } = vi.hoisted(() => {
	return { send: vi.fn(async (_options: EmailOptions): Promise<null> => null) };
});

const scopedCache = vi.hoisted(() => {
	// Off by default, as on the memory store the other tests run against.
	return { scoped: false };
});

vi.mock('../scoped-cache/index.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../scoped-cache/index.js')>();

	return { ...actual, scopedCachePurgeEnabled: () => scopedCache.scoped };
});

vi.mock('./mail/index.js', () => {
	return {
		MailService: vi.fn(function () {
			return { send };
		}),
	};
});

const schema = new SchemaBuilder()
	.collection('directus_shares', (c) => {
		c.field('id').id();
	})
	.build();

let db: Knex;
let tracker: Tracker;

beforeAll(() => {
	db = knex.default({ client: MockClient });
	tracker = createTracker(db);
});

afterEach(() => {
	tracker.reset();
	vi.restoreAllMocks();
	vi.mocked(clearPermissionsCache).mockClear();
	send.mockClear();
});

describe('Services / Shares', () => {
	describe('updateBatch', () => {
		it('clears the permissions cache', async () => {
			vi.spyOn(ItemsService.prototype, 'updateGroups').mockResolvedValue([1, 2]);
			const service = new SharesService({ knex: db, schema });

			await service.updateBatch([
				{ id: 1, max_uses: 3 },
				{ id: 2, max_uses: 5 },
			]);

			expect(clearPermissionsCache).toHaveBeenCalledTimes(1);
		});
	});

	describe('login', () => {
		beforeEach(() => {
			tracker.on.select('directus_shares').response([
				{ share_id: 's-1', share_times_used: 2, share_password: null },
			]);

			tracker.on.insert('directus_sessions').response([]);
			tracker.on.delete('directus_sessions').response(0);
		});

		afterEach(() => {
			scopedCache.scoped = false;
			vi.restoreAllMocks();
		});

		it(oneLine`
			counts the use through ItemsService, so the purge sees the row before and
			after the write, with no hook as upstream's raw write had none
		`, async () => {
			scopedCache.scoped = true;
			const countCalls: unknown[] = [];

			vi.spyOn(ItemsService.prototype, 'updateOne')
				.mockImplementation(async function (this: ItemsService, key, data, opts) {
					countCalls.push([this.collection, this.accountability, key, data, opts]);

					return key;
				});

			await new SharesService({ knex: db, schema }).login({ share: 's-1' });

			expect(countCalls).toEqual([
				[
					'directus_shares',
					null,
					's-1',
					{ times_used: 3 },
					{ emitEvents: false, autoPurgeCache: true },
				],
			]);
		});

		it(oneLine`
			leaves the cache alone in full mode, as upstream does: a full purge on every
			share login would flush the whole cache
		`, async () => {
			scopedCache.scoped = false;
			const countCalls: unknown[] = [];

			vi.spyOn(ItemsService.prototype, 'updateOne')
				.mockImplementation(async function (this: ItemsService, key, data, opts) {
					countCalls.push([this.collection, this.accountability, key, data, opts]);

					return key;
				});

			await new SharesService({ knex: db, schema }).login({ share: 's-1' });

			expect(countCalls).toEqual([
				[
					'directus_shares',
					null,
					's-1',
					{ times_used: 3 },
					{ emitEvents: false, autoPurgeCache: false },
				],
			]);
		});
	});

	describe('invite', () => {
		it('should throw ForbiddenError when accountability has no user', async () => {
			const service = new SharesService({ knex: db, schema, accountability: {} as Accountability });

			await expect(service.invite({ emails: ['test@example.com'], share: 1 })).rejects.toThrowError(ForbiddenError);

			await expect(service.invite({ emails: ['test@example.com'], share: 1 })).rejects.toThrowError(
				'You must be authenticated to send a share invite.',
			);
		});

		it('mails every invitee a link naming the sender', async () => {
			const readOne = vi.spyOn(ItemsService.prototype, 'readOne');

			readOne.mockResolvedValueOnce(
				withMeta({ collection: 'articles' }, { scopedCacheFingerprints: [] }),
			);

			readOne.mockResolvedValueOnce(
				withMeta(
					{ first_name: 'Ada', last_name: 'Lovelace' },
					{ scopedCacheFingerprints: [] },
				),
			);

			const service = new SharesService({
				knex: db,
				schema,
				accountability: { user: 'user-1' } as Accountability,
			});

			await service.invite({
				emails: ['first@example.com', 'second@example.com'],
				share: 1,
			});

			expect(send).toHaveBeenCalledTimes(2);

			expect(send.mock.calls.map(([options]) => options.to)).toEqual([
				'first@example.com',
				'second@example.com',
			]);

			const first = send.mock.calls[0]?.[0];

			expect(first?.subject).toBe(
				'Ada Lovelace has shared an item with you',
			);

			expect(first?.template?.data['html']).toContain(
				'Ada Lovelace has invited you',
			);
		});
	});
});
