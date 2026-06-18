import { ForbiddenError, InvalidPayloadError } from '@directus/errors';
import { SchemaBuilder } from '@directus/schema-builder';
import type { Accountability } from '@directus/types';
import knex from 'knex';
import { createTracker, MockClient } from 'knex-mock-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommentsService, ItemsService, NotificationsService, UsersService } from './index.js';

vi.mock('../../src/database/index', () => ({
	default: vi.fn(),
	getDatabaseClient: vi.fn().mockReturnValue('postgres'),
}));

vi.mock('@directus/env', () => ({
	useEnv: vi.fn().mockReturnValue({
		PUBLIC_URL: 'http://example.com',
		EMAIL_TEMPLATES_PATH: './templates',
	}),
}));

vi.mock('./mail', () => {
	const MailService = vi.fn();
	MailService.prototype.send = vi.fn().mockResolvedValue(undefined);
	return { MailService };
});

const warn = vi.fn();

vi.mock('../logger/index.js', () => ({
	useLogger: vi.fn().mockReturnValue({ warn: vi.fn((...args) => warn(...args)) }),
}));

const { validateAccessMock, fetchRolesTreeMock, fetchGlobalAccessMock } = vi.hoisted(() => ({
	validateAccessMock: vi.fn(),
	fetchRolesTreeMock: vi.fn(),
	fetchGlobalAccessMock: vi.fn(),
}));

vi.mock('../permissions/modules/validate-access/validate-access.js', () => ({
	validateAccess: validateAccessMock,
}));

vi.mock('../permissions/lib/fetch-roles-tree.js', () => ({
	fetchRolesTree: fetchRolesTreeMock,
}));

vi.mock('../permissions/modules/fetch-global-access/fetch-global-access.js', () => ({
	fetchGlobalAccess: fetchGlobalAccessMock,
}));

const schema = new SchemaBuilder()
	.collection('directus_comments', (c) => {
		c.field('id').uuid().primary();
	})
	.build();

const adminAccountability: Accountability = {
	user: 'b5f3a8e0-0000-4000-8000-000000000001',
	role: null,
	admin: true,
	app: true,
	roles: [],
	ip: null,
};

describe('Integration Tests', () => {
	const db = vi.mocked(knex.default({ client: MockClient }));
	createTracker(db);

	describe('Services / Comments', () => {
		let superCreateManySpy: ReturnType<typeof vi.spyOn>;
		let notificationCreateOneSpy: ReturnType<typeof vi.spyOn>;

		beforeEach(() => {
			superCreateManySpy = vi.spyOn(ItemsService.prototype, 'createMany').mockResolvedValue(['comment-id-1']);

			notificationCreateOneSpy = vi
				.spyOn(NotificationsService.prototype, 'createOne')
				.mockResolvedValue('notification-id');

			validateAccessMock.mockResolvedValue(undefined);
			fetchRolesTreeMock.mockResolvedValue([]);
			fetchGlobalAccessMock.mockResolvedValue({ admin: false, app: true });
		});

		afterEach(() => {
			vi.clearAllMocks();
		});

		const makeService = (accountability: Accountability | null = adminAccountability) =>
			new CommentsService({ knex: db, schema, accountability });

		it('throws ForbiddenError when there is no authenticated user', async () => {
			const service = makeService(null);

			await expect(service.createMany([{ comment: 'hi', collection: 'articles', item: '1' }])).rejects.toBeInstanceOf(
				ForbiddenError,
			);
		});

		it('throws InvalidPayloadError when "comment" is missing', async () => {
			const service = makeService();

			await expect(service.createMany([{ collection: 'articles', item: '1' } as any])).rejects.toBeInstanceOf(
				InvalidPayloadError,
			);
		});

		it('throws InvalidPayloadError when "collection" is missing', async () => {
			const service = makeService();

			await expect(service.createMany([{ comment: 'hi', item: '1' } as any])).rejects.toBeInstanceOf(
				InvalidPayloadError,
			);
		});

		it('throws InvalidPayloadError when "item" is missing', async () => {
			const service = makeService();

			await expect(service.createMany([{ comment: 'hi', collection: 'articles' } as any])).rejects.toBeInstanceOf(
				InvalidPayloadError,
			);
		});

		it('creates the comment without notifications when there are no mentions', async () => {
			const service = makeService();

			const result = await service.createMany([{ comment: 'plain comment', collection: 'articles', item: '1' }]);

			expect(result).toEqual(['comment-id-1']);
			expect(superCreateManySpy).toHaveBeenCalledTimes(1);
			expect(notificationCreateOneSpy).not.toHaveBeenCalled();
		});

		it('creates a notification for each mentioned user', async () => {
			const mentioned = 'a1b2c3d4-0000-4000-8000-00000000000a';
			const service = makeService();

			vi.spyOn(UsersService.prototype, 'readOne').mockImplementation(async (key: any) => ({
				id: key,
				first_name: 'Test',
				last_name: 'User',
				email: 'test@example.com',
				role: { id: null },
			}));

			vi.spyOn(UsersService.prototype, 'readByQuery').mockResolvedValue([
				{ id: mentioned, first_name: 'Test', last_name: 'User', email: 'test@example.com' },
			]);

			await service.createMany([{ comment: `hey @${mentioned}`, collection: 'articles', item: '1' }]);

			expect(notificationCreateOneSpy).toHaveBeenCalledTimes(1);

			expect(notificationCreateOneSpy).toHaveBeenCalledWith(
				expect.objectContaining({ recipient: mentioned, collection: 'articles', item: '1' }),
			);
		});

		it('skips a mention (warns, does not throw) when the recipient lacks read access', async () => {
			const mentioned = 'a1b2c3d4-0000-4000-8000-00000000000b';
			const service = makeService();

			vi.spyOn(UsersService.prototype, 'readOne').mockImplementation(async (key: any) => ({
				id: key,
				first_name: 'Test',
				last_name: 'User',
				email: 'test@example.com',
				role: { id: null },
			}));

			// First call (sender's own access) passes; the mentioned recipient's check throws Forbidden.
			validateAccessMock.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new ForbiddenError());

			await expect(
				service.createMany([{ comment: `hey @${mentioned}`, collection: 'articles', item: '1' }]),
			).resolves.toEqual(['comment-id-1']);

			expect(notificationCreateOneSpy).not.toHaveBeenCalled();
			expect(warn).toHaveBeenCalled();
		});
	});
});
