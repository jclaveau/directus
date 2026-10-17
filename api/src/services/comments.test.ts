import type { Accountability } from '@directus/types';
import knex from 'knex';
import { MockClient } from 'knex-mock-client';
import { ForbiddenError } from '@directus/errors';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCache } from '../cache.js';
import { fetchRolesTree } from '../permissions/lib/fetch-roles-tree.js';
import {
	fetchGlobalAccess,
} from '../permissions/modules/fetch-global-access/fetch-global-access.js';
import {
	validateAccess,
} from '../permissions/modules/validate-access/validate-access.js';
import { withMeta } from '../utils/read-meta.js';
import { CommentsService } from './comments.js';
import { ItemsService } from './items.js';
import { NotificationsService } from './notifications.js';
import { UsersService } from './users.js';

vi.mock('../../src/database/index.js', () => ({
	__esModule: true,
	default: vi.fn(),
	getDatabaseClient: vi.fn().mockReturnValue('postgres'),
}));

vi.mock('../cache.js', () => ({
	getCache: vi.fn().mockReturnValue({ cache: null, systemCache: null, localSchemaCache: null, lockCache: null }),
}));

vi.mock('@directus/env', () => ({
	useEnv: vi.fn(() => ({ PUBLIC_URL: 'http://example.com' })),
}));

const { loggerWarn } = vi.hoisted(() => ({ loggerWarn: vi.fn() }));

vi.mock('../logger/index.js', () => ({
	useLogger: vi.fn(() => ({ warn: loggerWarn, info: vi.fn(), error: vi.fn() })),
}));

vi.mock('../permissions/lib/fetch-roles-tree.js', () => ({
	fetchRolesTree: vi.fn().mockResolvedValue([]),
}));

vi.mock('../permissions/modules/fetch-global-access/fetch-global-access.js', () => ({
	fetchGlobalAccess: vi.fn().mockResolvedValue({ admin: true, app: true }),
}));

vi.mock('../permissions/modules/validate-access/validate-access.js', () => ({
	validateAccess: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./notifications.js', () => {
	const NotificationsService = vi.fn();

	NotificationsService.prototype.createOne = vi.fn()
		.mockResolvedValue('notification-id');

	return { NotificationsService };
});

vi.mock('./users.js', () => {
	const UsersService = vi.fn();
	UsersService.prototype.readOne = vi.fn();
	UsersService.prototype.readByQuery = vi.fn();
	return { UsersService };
});

const senderUuid = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const mentionUuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const schema = { collections: {}, relations: {} } as any;

const accountability: Accountability = {
	user: senderUuid,
	role: null,
	admin: true,
	app: true,
	roles: [],
	ip: null,
};

describe('Services / Comments', () => {
	const db = knex.default({ client: MockClient });

	beforeEach(() => {
		vi.mocked(getCache).mockReturnValue({
			cache: null,
			systemCache: null,
			localSchemaCache: null,
			lockCache: null,
		} as any);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		// Restoring only unpatches the spies since vitest 4 — the module mocks keep
		// their calls until they are reset.
		vi.resetAllMocks();
	});

	it('should expand a valid @mention into its user preview in the notification message (line 137)', async () => {
		const superCreateManySpy = vi.spyOn(ItemsService.prototype, 'createMany')
			.mockResolvedValue(['comment-pk-1']);

		const service = new CommentsService({ knex: db, schema, accountability });

		vi.mocked(UsersService.prototype.readOne)
			.mockResolvedValueOnce(withMeta({
				id: senderUuid,
				first_name: 'Sam',
				last_name: 'Sender',
				email: 'sam@x.com',
			}, { scopedCacheFingerprints: [] }))
			.mockResolvedValueOnce(withMeta({
				id: mentionUuid,
				first_name: 'Jane',
				last_name: 'Doe',
				email: 'jane@x.com',
				role: { id: null },
			}, { scopedCacheFingerprints: [] }));

		vi.mocked(UsersService.prototype.readByQuery).mockResolvedValue(withMeta([
			{ id: mentionUuid, first_name: 'Jane', last_name: 'Doe', email: 'jane@x.com' },
		], { scopedCacheFingerprints: [] }));

		const result = await service.createMany([
			{
				comment: `hey @${mentionUuid} please review`,
				collection: 'articles',
				item: '42',
			},
		]);

		expect(result).toEqual(['comment-pk-1']);
		expect(superCreateManySpy).toHaveBeenCalledTimes(1);

		expect(NotificationsService.prototype.createOne).toHaveBeenCalledTimes(1);

		const [notification] = vi.mocked(NotificationsService.prototype.createOne).mock.calls[0]!;

		expect(notification.recipient).toBe(mentionUuid);
		expect(notification.sender).toBe(senderUuid);
		expect(notification.collection).toBe('articles');
		expect(notification.item).toBe('42');

		// line 137: the raw @<uuid> mention is replaced by the <em>userName</em> preview
		expect(notification.message).toContain('<em>Jane Doe</em>');
		expect(notification.message).not.toContain(`@${mentionUuid}`);
	});

	it('should early-continue without sending a notification when there are no mentions (lines 68-70)', async () => {
		const superCreateManySpy = vi.spyOn(ItemsService.prototype, 'createMany')
			.mockResolvedValue(['comment-pk-2']);

		const service = new CommentsService({ knex: db, schema, accountability });

		const result = await service.createMany([
			{
				comment: 'a plain comment with no mentions',
				collection: 'articles',
				item: '7',
			},
		]);

		expect(result).toEqual(['comment-pk-2']);
		expect(superCreateManySpy).toHaveBeenCalledTimes(1);
		expect(UsersService.prototype.readOne).not.toHaveBeenCalled();
		expect(NotificationsService.prototype.createOne).not.toHaveBeenCalled();
	});

	it('notifies a mentioned user who cannot read users', async () => {
		vi.spyOn(ItemsService.prototype, 'createMany')
			.mockResolvedValue(['comment-pk-3']);

		const service = new CommentsService({ knex: db, schema, accountability });

		vi.mocked(UsersService.prototype.readOne)
			.mockResolvedValueOnce(withMeta({
				id: senderUuid,
				first_name: 'Sam',
				last_name: 'Sender',
				email: 'sam@x.com',
			}, { scopedCacheFingerprints: [] }))
			.mockResolvedValueOnce(withMeta({
				id: mentionUuid,
				first_name: 'Jane',
				last_name: 'Doe',
				email: 'jane@x.com',
				role: { id: null },
			}, { scopedCacheFingerprints: [] }));

		vi.mocked(fetchRolesTree).mockResolvedValue([]);
		vi.mocked(validateAccess).mockResolvedValue(undefined);

		vi.mocked(fetchGlobalAccess)
			.mockResolvedValue({
				admin: false,
				app: false,
				grantedDbConnections: [],
			});

		vi.mocked(UsersService.prototype.readByQuery)
			.mockResolvedValueOnce(withMeta([
				{ id: mentionUuid },
			], { scopedCacheFingerprints: [] }))
			.mockRejectedValueOnce(new ForbiddenError());

		const result = await service.createMany([
			{
				comment: `hey @${mentionUuid} please review`,
				collection: 'articles',
				item: '42',
			},
		]);

		expect(result).toEqual(['comment-pk-3']);

		expect(NotificationsService.prototype.createOne)
			.toHaveBeenCalledExactlyOnceWith({
				recipient: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
				sender: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
				subject: 'You were mentioned in articles',
				message: `
Hello Jane Doe,

Sam Sender has mentioned you in a comment:

> hey @Unknown User please review

<a href="http://example.com/admin/content/articles/42">Click here to view.</a>
`,
				collection: 'articles',
				item: '42',
			});

		expect(loggerWarn).not.toHaveBeenCalled();
	});

	it('refuses a mention of a user no row holds, before the insert', async () => {
		const superCreateManySpy = vi.spyOn(ItemsService.prototype, 'createMany')
			.mockResolvedValue(['comment-pk-7']);

		const service = new CommentsService({ knex: db, schema, accountability });

		vi.mocked(UsersService.prototype.readByQuery)
			.mockResolvedValueOnce(withMeta([], { scopedCacheFingerprints: [] }));

		await expect(service.createMany([
			{
				comment: `hey @${mentionUuid} please review`,
				collection: 'articles',
				item: '42',
			},
		])).rejects.toMatchObject({
			status: 404,
			message: 'Item "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" doesn\'t exist'
				+ ' in collection "directus_users".',
		});

		expect(superCreateManySpy).not.toHaveBeenCalled();
		expect(NotificationsService.prototype.createOne).not.toHaveBeenCalled();
	});

	it('resolves a mention written in upper case', async () => {
		vi.spyOn(ItemsService.prototype, 'createMany')
			.mockResolvedValue(['comment-pk-8']);

		const service = new CommentsService({ knex: db, schema, accountability });

		vi.mocked(UsersService.prototype.readOne)
			.mockResolvedValueOnce(withMeta({
				id: senderUuid,
				first_name: 'Sam',
				last_name: 'Sender',
				email: 'sam@x.com',
			}, { scopedCacheFingerprints: [] }))
			.mockResolvedValueOnce(withMeta({
				id: mentionUuid,
				first_name: 'Jane',
				last_name: 'Doe',
				email: 'jane@x.com',
				role: { id: null },
			}, { scopedCacheFingerprints: [] }));

		vi.mocked(fetchGlobalAccess)
			.mockResolvedValue({
				admin: false,
				app: true,
				grantedDbConnections: [],
			});

		vi.mocked(UsersService.prototype.readByQuery)
			.mockResolvedValue(withMeta([
				{ id: mentionUuid },
			], { scopedCacheFingerprints: [] }));

		const result = await service.createMany([
			{
				comment: 'hey @AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
				collection: 'articles',
				item: '42',
			},
		]);

		expect(result).toEqual(['comment-pk-8']);

		expect(NotificationsService.prototype.createOne)
			.toHaveBeenCalledOnce();
	});

	describe('as an author who is not an admin', () => {
		const authorAccountability: Accountability = {
			user: senderUuid,
			role: null,
			admin: false,
			app: true,
			roles: [],
			ip: null,
		};

		it('skips a mention when the author cannot read users', async () => {
			vi.spyOn(ItemsService.prototype, 'createMany')
				.mockResolvedValue(['comment-pk-4']);

			const service = new CommentsService({
				knex: db,
				schema,
				accountability: authorAccountability,
			});

			vi.mocked(UsersService.prototype.readOne)
				.mockResolvedValueOnce(withMeta({
					id: senderUuid,
					first_name: 'Sam',
					last_name: 'Sender',
					email: 'sam@x.com',
				}, { scopedCacheFingerprints: [] }));

			vi.mocked(UsersService.prototype.readByQuery)
				.mockRejectedValue(new ForbiddenError());

			const result = await service.createMany([
				{
					comment: `hey @${mentionUuid} please review`,
					collection: 'articles',
					item: '42',
				},
			]);

			expect(result).toEqual(['comment-pk-4']);
			expect(UsersService.prototype.readOne).toHaveBeenCalledOnce();
			expect(NotificationsService.prototype.createOne).not.toHaveBeenCalled();

			expect(loggerWarn).toHaveBeenCalledExactlyOnceWith(
				'Mention of user "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" skipped:'
				+ ' the author cannot read that user',
			);
		});

		it('skips a mention of a user the author cannot read', async () => {
			const superCreateManySpy = vi.spyOn(ItemsService.prototype, 'createMany')
				.mockResolvedValue(['comment-pk-5']);

			const service = new CommentsService({
				knex: db,
				schema,
				accountability: authorAccountability,
			});

			vi.mocked(UsersService.prototype.readOne)
				.mockResolvedValueOnce(withMeta({
					id: senderUuid,
					first_name: 'Sam',
					last_name: 'Sender',
					email: 'sam@x.com',
				}, { scopedCacheFingerprints: [] }));

			vi.mocked(UsersService.prototype.readByQuery)
				.mockResolvedValueOnce(withMeta([], { scopedCacheFingerprints: [] }));

			const result = await service.createMany([
				{
					comment: `hey @${mentionUuid} please review`,
					collection: 'articles',
					item: '42',
				},
			]);

			expect(result).toEqual(['comment-pk-5']);
			expect(superCreateManySpy).toHaveBeenCalledOnce();

			expect(UsersService.prototype.readByQuery)
				.toHaveBeenCalledExactlyOnceWith({
					fields: ['id'],
					filter: {
						id: { _in: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'] },
					},
					limit: -1,
				});

			expect(NotificationsService.prototype.createOne).not.toHaveBeenCalled();

			expect(loggerWarn).toHaveBeenCalledExactlyOnceWith(
				'Mention of user "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" skipped:'
				+ ' the author cannot read that user',
			);
		});

		it('notifies a mentioned user the author can read', async () => {
			vi.spyOn(ItemsService.prototype, 'createMany')
				.mockResolvedValue(['comment-pk-6']);

			const service = new CommentsService({
				knex: db,
				schema,
				accountability: authorAccountability,
			});

			vi.mocked(UsersService.prototype.readOne)
				.mockResolvedValueOnce(withMeta({
					id: senderUuid,
					first_name: 'Sam',
					last_name: 'Sender',
					email: 'sam@x.com',
				}, { scopedCacheFingerprints: [] }))
				.mockResolvedValueOnce(withMeta({
					id: mentionUuid,
					first_name: 'Jane',
					last_name: 'Doe',
					email: 'jane@x.com',
					role: { id: null },
				}, { scopedCacheFingerprints: [] }));

			vi.mocked(fetchRolesTree).mockResolvedValue([]);
			vi.mocked(validateAccess).mockResolvedValue(undefined);

			vi.mocked(fetchGlobalAccess)
				.mockResolvedValue({
					admin: false,
					app: true,
					grantedDbConnections: [],
				});

			vi.mocked(UsersService.prototype.readByQuery)
				.mockResolvedValueOnce(withMeta([
					{ id: mentionUuid },
				], { scopedCacheFingerprints: [] }))
				.mockResolvedValueOnce(withMeta([
					{
						id: mentionUuid,
						first_name: 'Jane',
						last_name: 'Doe',
						email: 'jane@x.com',
					},
				], { scopedCacheFingerprints: [] }));

			const result = await service.createMany([
				{
					comment: `hey @${mentionUuid} please review`,
					collection: 'articles',
					item: '42',
				},
			]);

			expect(result).toEqual(['comment-pk-6']);

			expect(NotificationsService.prototype.createOne)
				.toHaveBeenCalledExactlyOnceWith({
					recipient: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
					sender: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
					subject: 'You were mentioned in articles',
					message: `
Hello Jane Doe,

Sam Sender has mentioned you in a comment:

> hey <em>Jane Doe</em> please review

<a href="http://example.com/admin/content/articles/42">Click here to view.</a>
`,
					collection: 'articles',
					item: '42',
				});

			expect(loggerWarn).not.toHaveBeenCalled();
		});
	});
});
