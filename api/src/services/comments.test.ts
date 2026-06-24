import type { Accountability } from '@directus/types';
import knex from 'knex';
import { MockClient } from 'knex-mock-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCache } from '../cache.js';
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

vi.mock('../logger/index.js', () => ({
	useLogger: vi.fn(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() })),
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
	NotificationsService.prototype.createOne = vi.fn().mockResolvedValue('notification-id');
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
	const db = vi.mocked(knex.default({ client: MockClient }));

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
	});

	it('should expand a valid @mention into its user preview in the notification message (line 130)', async () => {
		const superCreateOneSpy = vi.spyOn(ItemsService.prototype, 'createOne').mockResolvedValue('comment-pk-1');

		const service = new CommentsService({ knex: db, schema, accountability });

		vi.mocked(UsersService.prototype.readOne)
			.mockResolvedValueOnce({
				id: senderUuid,
				first_name: 'Sam',
				last_name: 'Sender',
				email: 'sam@x.com',
			})
			.mockResolvedValueOnce({
				id: mentionUuid,
				first_name: 'Jane',
				last_name: 'Doe',
				email: 'jane@x.com',
				role: { id: null },
			});

		vi.mocked(UsersService.prototype.readByQuery).mockResolvedValue([
			{ id: mentionUuid, first_name: 'Jane', last_name: 'Doe', email: 'jane@x.com' },
		]);

		const result = await service.createOne({
			comment: `hey @${mentionUuid} please review`,
			collection: 'articles',
			item: '42',
		});

		expect(result).toBe('comment-pk-1');
		expect(superCreateOneSpy).toHaveBeenCalledTimes(1);

		expect(NotificationsService.prototype.createOne).toHaveBeenCalledTimes(1);

		const [notification] = vi.mocked(NotificationsService.prototype.createOne).mock.calls[0]!;

		expect(notification.recipient).toBe(mentionUuid);
		expect(notification.sender).toBe(senderUuid);
		expect(notification.collection).toBe('articles');
		expect(notification.item).toBe('42');

		// line 130: the raw @<uuid> mention is replaced by the <em>userName</em> preview
		expect(notification.message).toContain('<em>Jane Doe</em>');
		expect(notification.message).not.toContain(`@${mentionUuid}`);
	});

	it('should early-return without sending a notification when there are no mentions (lines 65-67)', async () => {
		const superCreateOneSpy = vi.spyOn(ItemsService.prototype, 'createOne').mockResolvedValue('comment-pk-2');

		const service = new CommentsService({ knex: db, schema, accountability });

		const result = await service.createOne({
			comment: 'a plain comment with no mentions',
			collection: 'articles',
			item: '7',
		});

		expect(result).toBe('comment-pk-2');
		expect(superCreateOneSpy).toHaveBeenCalledTimes(1);
		expect(UsersService.prototype.readOne).not.toHaveBeenCalled();
		expect(NotificationsService.prototype.createOne).not.toHaveBeenCalled();
	});
});
