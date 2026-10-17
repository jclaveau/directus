import {
	ForbiddenError,
	InvalidCredentialsError,
	ItemNotFoundError,
} from '@directus/errors';
import { SchemaBuilder } from '@directus/schema-builder';
import type { Accountability } from '@directus/types';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import knex, { type Knex } from 'knex';
import { MockClient, Tracker, createTracker } from 'knex-mock-client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { useLogger } from '../logger/index.js';
import { clearCache as clearPermissionsCache } from '../permissions/cache.js';
import {
	validateAccess,
} from '../permissions/modules/validate-access/validate-access.js';
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

vi.mock('../permissions/modules/validate-access/validate-access.js', () => {
	return {
		validateAccess: vi.fn(),
	};
});

vi.mock('../utils/get-secret.js', () => {
	return {
		getSecret: () => 'test-secret',
	};
});

vi.mock('nanoid', () => {
	return {
		nanoid: () => 'refresh-token-1',
	};
});

const { send } = vi.hoisted(() => {
	return { send: vi.fn(async (_options: EmailOptions): Promise<null> => null) };
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
	vi.mocked(validateAccess).mockReset();
	vi.useRealTimers();
	send.mockClear();
});

describe('Services / Shares', () => {
	describe('createMany', () => {
		it('checks the caller may share each item before creating', async () => {
			const createMany = vi.spyOn(ItemsService.prototype, 'createMany')
				.mockResolvedValue(['share-id-5', 'share-id-6', 'share-id-7']);

			const service = new SharesService({
				knex: db,
				schema,
				accountability: { user: 'user-1' } as Accountability,
			});

			await expect(service.createMany([
				{ collection: 'articles', item: '7' },
				{ collection: 'pages', item: '3' },
				{ collection: 'articles', item: '8' },
				{ collection: 'articles', item: '7' },
			])).resolves.toStrictEqual(['share-id-5', 'share-id-6', 'share-id-7']);

			expect(vi.mocked(validateAccess).mock.calls).toStrictEqual([
				[
					{
						accountability: { user: 'user-1' },
						action: 'share',
						collection: 'articles',
						primaryKeys: ['7', '8'],
					},
					{ schema, knex: db },
				],
				[
					{
						accountability: { user: 'user-1' },
						action: 'share',
						collection: 'pages',
						primaryKeys: ['3'],
					},
					{ schema, knex: db },
				],
			]);

			expect(createMany).toHaveBeenCalledWith(
				[
					{ collection: 'articles', item: '7' },
					{ collection: 'pages', item: '3' },
					{ collection: 'articles', item: '8' },
					{ collection: 'articles', item: '7' },
				],
				undefined,
			);
		});

		it('refuses a batch holding a share the caller may not make', async () => {
			vi.mocked(validateAccess).mockRejectedValue(new ForbiddenError());

			const createMany = vi.spyOn(ItemsService.prototype, 'createMany')
				.mockResolvedValue(['share-id-8', 'share-id-9']);

			await expect(new SharesService({
				knex: db,
				schema,
				accountability: { user: 'user-1' } as Accountability,
			}).createMany([
				{ collection: 'articles', item: '7' },
				{ collection: 'articles', item: '9' },
			])).rejects.toStrictEqual(new ForbiddenError());

			expect(createMany).not.toHaveBeenCalled();
		});

		it('checks a single share before creating it', async () => {
			const createMany = vi.spyOn(ItemsService.prototype, 'createMany')
				.mockResolvedValue(['share-id-1']);

			const service = new SharesService({
				knex: db,
				schema,
				accountability: { user: 'user-1' } as Accountability,
			});

			await expect(service.createOne({ collection: 'articles', item: '7' }))
				.resolves.toBe('share-id-1');

			expect(validateAccess).toHaveBeenCalledWith(
				{
					accountability: { user: 'user-1' },
					action: 'share',
					collection: 'articles',
					primaryKeys: ['7'],
				},
				{ schema, knex: db },
			);

			expect(createMany).toHaveBeenCalledWith(
				[{ collection: 'articles', item: '7' }],
				{},
			);
		});

		it('creates without an access check when no caller is set', async () => {
			vi.spyOn(ItemsService.prototype, 'createMany')
				.mockResolvedValue(['share-id-3']);

			const service = new SharesService({ knex: db, schema });

			await expect(service.createMany([{ collection: 'articles', item: '7' }]))
				.resolves.toStrictEqual(['share-id-3']);

			expect(validateAccess).not.toHaveBeenCalled();
		});
	});

	describe('deleteMany', () => {
		it('clears the permissions cache', async () => {
			const deleteMany = vi.spyOn(ItemsService.prototype, 'deleteMany')
				.mockResolvedValue(['share-id-4']);

			const service = new SharesService({ knex: db, schema });

			await expect(service.deleteMany(['share-id-4']))
				.resolves.toStrictEqual(['share-id-4']);

			expect(clearPermissionsCache).toHaveBeenCalledTimes(1);
			expect(deleteMany).toHaveBeenCalledWith(['share-id-4'], undefined);
		});
	});

	describe('login', () => {
		it('refuses a share the lookup finds no row for', async () => {
			tracker.on.select('directus_shares').response(undefined);

			const service = new SharesService({ knex: db, schema });

			await expect(service.login({ share: 'share-id-5' }))
				.rejects.toStrictEqual(new InvalidCredentialsError());

			expect(tracker.history.update).toStrictEqual([]);
		});

		it('refuses a wrong password', async () => {
			tracker.on.select('directus_shares').response({
				share_id: 'share-id-6',
				share_times_used: 0,
				share_password: '$argon2id$stored-hash',
			});

			const verifyPassword = vi.spyOn(argon2, 'verify').mockResolvedValue(false);
			const service = new SharesService({ knex: db, schema });

			await expect(service.login({ share: 'share-id-6', password: 'wrong' }))
				.rejects.toStrictEqual(new InvalidCredentialsError());

			expect(verifyPassword).toHaveBeenCalledWith('$argon2id$stored-hash', 'wrong');
			expect(tracker.history.update).toStrictEqual([]);
		});

		it('counts the use and opens a session for the share', async () => {
			vi.useFakeTimers({
				now: new Date('2026-01-01T00:00:00.000Z'),
				toFake: ['Date'],
			});

			tracker.on.select('directus_shares').response({
				share_id: 'share-id-7',
				share_times_used: 2,
				share_password: null,
			});

			tracker.on.update('directus_shares').response(1);
			tracker.on.insert('directus_sessions').response([]);
			tracker.on.delete('directus_sessions').response(0);

			const signToken = vi.spyOn(jwt, 'sign')
				.mockReturnValue('access-token-1' as any);

			const service = new SharesService({ knex: db, schema });

			await expect(service.login({ share: 'share-id-7' })).resolves
				.toStrictEqual({
					accessToken: 'access-token-1',
					refreshToken: 'refresh-token-1',
					expires: 900000,
				});

			expect(signToken).toHaveBeenCalledWith(
				{
					app_access: false,
					admin_access: false,
					role: null,
					share: 'share-id-7',
				},
				'test-secret',
				{ expiresIn: '15m', issuer: 'directus' },
			);

			expect(tracker.history.update[0]?.bindings)
				.toStrictEqual([3, 'share-id-7']);

			expect(tracker.history.insert[0]?.bindings).toStrictEqual([
				new Date('2026-01-08T00:00:00.000Z'),
				'share-id-7',
				'refresh-token-1',
			]);
		});

		it('binds the access token to the session it opens', async () => {
			tracker.on.select('directus_shares').response({
				share_id: 'share-id-8',
				share_times_used: 0,
				share_password: '$argon2id$stored-hash',
			});

			tracker.on.update('directus_shares').response(1);
			tracker.on.insert('directus_sessions').response([]);
			tracker.on.delete('directus_sessions').response(0);
			vi.spyOn(argon2, 'verify').mockResolvedValue(true);

			const signToken = vi.spyOn(jwt, 'sign')
				.mockReturnValue('access-token-2' as any);

			const service = new SharesService({ knex: db, schema });

			await expect(service.login(
				{ share: 'share-id-8', password: 'right' },
				{ session: true },
			)).resolves.toStrictEqual({
				accessToken: 'access-token-2',
				refreshToken: 'refresh-token-1',
				expires: 86400000,
			});

			expect(signToken).toHaveBeenCalledWith(
				{
					app_access: false,
					admin_access: false,
					role: null,
					share: 'share-id-8',
					session: 'refresh-token-1',
				},
				'test-secret',
				{ expiresIn: '1d', issuer: 'directus' },
			);
		});
	});

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

	describe('updateGroups', () => {
		it('refuses re-pointing to an item the caller may not share', async () => {
			vi.mocked(validateAccess).mockRejectedValue(new ForbiddenError({
				reason: 'You don\'t have permission to perform "share" for collection'
					+ ' "secret_docs" or it does not exist.',
			}));

			const updateGroups = vi.spyOn(ItemsService.prototype, 'updateGroups')
				.mockResolvedValue([1]);

			await expect(new SharesService({
				knex: db,
				schema,
				accountability: { user: 'user-1' } as Accountability,
			}).updateOne(1, { collection: 'secret_docs', item: '7' }))
				.rejects.toStrictEqual(new ForbiddenError({
					reason: 'You don\'t have permission to perform "share" for collection'
						+ ' "secret_docs" or it does not exist.',
				}));

			expect(vi.mocked(validateAccess).mock.calls).toStrictEqual([
				[
					{
						accountability: { user: 'user-1' },
						action: 'share',
						collection: 'secret_docs',
						primaryKeys: ['7'],
					},
					{ schema, knex: db },
				],
			]);

			expect(tracker.history.select).toStrictEqual([]);
			expect(updateGroups).not.toHaveBeenCalled();
		});

		it('checks a changed item against the collection the share holds', async () => {
			tracker.on.select('directus_shares').response([
				{ id: 1, collection: 'articles', item: '3' },
				{ id: 2, collection: 'pages', item: '4' },
			]);

			const updateGroups = vi.spyOn(ItemsService.prototype, 'updateGroups')
				.mockResolvedValue([1, 2, 3]);

			await expect(new SharesService({
				knex: db,
				schema,
				accountability: { user: 'user-1' } as Accountability,
			}).updateBatch([
				{ id: 1, item: '7' },
				{ id: 2, item: '8' },
				{ id: 3, collection: 'articles', item: '9' },
			])).resolves.toStrictEqual([1, 2, 3]);

			expect(tracker.history.select).toHaveLength(1);

			expect(tracker.history.select[0]?.sql).toBe(
				'select "id", "collection", "item" from "directus_shares"'
					+ ' where "id" in (?, ?)',
			);

			expect(tracker.history.select[0]?.bindings).toStrictEqual([1, 2]);

			expect(vi.mocked(validateAccess).mock.calls).toStrictEqual([
				[
					{
						accountability: { user: 'user-1' },
						action: 'share',
						collection: 'articles',
						primaryKeys: ['7', '9'],
					},
					{ schema, knex: db },
				],
				[
					{
						accountability: { user: 'user-1' },
						action: 'share',
						collection: 'pages',
						primaryKeys: ['8'],
					},
					{ schema, knex: db },
				],
			]);

			expect(updateGroups).toHaveBeenCalledWith(
				[
					{ data: { item: '7' }, keys: [1] },
					{ data: { item: '8' }, keys: [2] },
					{ data: { collection: 'articles', item: '9' }, keys: [3] },
				],
				{},
			);
		});

		it('refuses re-pointing a share no row holds', async () => {
			tracker.on.select('directus_shares').response([]);

			const updateGroups = vi.spyOn(ItemsService.prototype, 'updateGroups')
				.mockResolvedValue([5]);

			await expect(new SharesService({
				knex: db,
				schema,
				accountability: { user: 'user-1' } as Accountability,
			}).updateOne(5, { item: '7' }))
				.rejects.toStrictEqual(new ForbiddenError({
					reason: 'You don\'t have permission to perform "update" for collection'
						+ ' "directus_shares" or it does not exist.',
				}));

			expect(validateAccess).not.toHaveBeenCalled();
			expect(updateGroups).not.toHaveBeenCalled();
		});

		it('answers an admin re-pointing a share no row holds with a 404', async () => {
			tracker.on.select('directus_shares').response([]);

			const updateGroups = vi.spyOn(ItemsService.prototype, 'updateGroups')
				.mockResolvedValue([5]);

			await expect(new SharesService({
				knex: db,
				schema,
				accountability: { user: 'user-1', admin: true } as Accountability,
			}).updateBatch([{ id: 5, item: '7' }]))
				.rejects.toStrictEqual(new ItemNotFoundError({
					collection: 'directus_shares',
					primaryKey: 5,
				}));

			expect(validateAccess).not.toHaveBeenCalled();
			expect(updateGroups).not.toHaveBeenCalled();
		});

		it('runs no share check for a change leaving the target alone', async () => {
			const updateGroups = vi.spyOn(ItemsService.prototype, 'updateGroups')
				.mockResolvedValue([1]);

			await expect(new SharesService({
				knex: db,
				schema,
				accountability: { user: 'user-1' } as Accountability,
			}).updateMany([1], { name: 'renamed', max_uses: 3 }))
				.resolves.toStrictEqual([1]);

			expect(validateAccess).not.toHaveBeenCalled();
			expect(tracker.history.select).toStrictEqual([]);

			expect(updateGroups).toHaveBeenCalledWith(
				[{ data: { name: 'renamed', max_uses: 3 }, keys: [1] }],
				{},
			);
		});

		it('re-points without a share check when no caller is set', async () => {
			vi.spyOn(ItemsService.prototype, 'updateGroups').mockResolvedValue([1]);

			await expect(new SharesService({ knex: db, schema })
				.updateOne(1, { item: '7' })).resolves.toBe(1);

			expect(validateAccess).not.toHaveBeenCalled();
			expect(tracker.history.select).toStrictEqual([]);
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

		it('logs an invite mail that fails to send', async () => {
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

			const mailError = new Error('SMTP down');
			send.mockRejectedValueOnce(mailError);
			const logError = vi.spyOn(useLogger(), 'error').mockReturnValue();

			const service = new SharesService({
				knex: db,
				schema,
				accountability: { user: 'user-1' } as Accountability,
			});

			await service.invite({ emails: ['first@example.com'], share: 1 });

			await vi.waitFor(() => {
				expect(logError).toHaveBeenCalledWith(
					mailError,
					'Could not send share notification mail',
				);
			});
		});
	});
});
