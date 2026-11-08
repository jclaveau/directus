import { oneLine } from '@directus/utils';
import knex from 'knex';
import { MockClient, createTracker } from 'knex-mock-client';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import getDatabase from '../database/index.js';
import { useLogger } from '../logger/index.js';
import { withMeta } from '../utils/read-meta.js';
import { transaction } from '../utils/transaction.js';
import { ItemsService } from './items.js';
import { MailService } from './mail/index.js';
import { NotificationsService } from './notifications.js';
import { UsersService } from './users.js';

vi.mock('../database/index.js', () => {
	return { default: vi.fn(), getDatabaseClient: vi.fn(() => 'postgres') };
});

vi.mock('@directus/env', () => {
	return { useEnv: vi.fn(() => ({ PUBLIC_URL: 'http://example.com' })) };
});

vi.mock('../permissions/lib/fetch-roles-tree.js', () => {
	return { fetchRolesTree: vi.fn().mockResolvedValue([]) };
});

vi.mock(
	'../permissions/modules/fetch-global-access/fetch-global-access.js',
	() => ({ fetchGlobalAccess: vi.fn().mockResolvedValue({ app: false }) }),
);

vi.mock('../logger/index.js', () => {
	const logger = { error: vi.fn(), warn: vi.fn(), debug: vi.fn(), trace: vi.fn() };

	return { useLogger: () => logger };
});

vi.mock('./mail/index.js', () => {
	const MailService = vi.fn();
	MailService.prototype.send = vi.fn().mockResolvedValue(undefined);
	return { MailService };
});

vi.mock('./users.js', () => {
	const UsersService = vi.fn();
	UsersService.prototype.readOne = vi.fn();
	return { UsersService };
});

const schema = { collections: {}, relations: {} } as any;

describe('NotificationsService.createMany', () => {
	beforeEach(() => {
		vi.clearAllMocks();

		vi.spyOn(ItemsService.prototype, 'createMany')
			.mockImplementation(async (_data, opts) => {
				opts?.onItemsCreate?.([{
					primaryKey: 'notification-a',
					payload: { recipient: 'user-a', subject: 'Hi' },
				}]);

				return ['notification-a'];
			});

		vi.mocked(UsersService.prototype.readOne).mockResolvedValue(withMeta({
			id: 'user-a',
			email: 'user-a@example.com',
			email_notifications: true,
			role: null,
		}, { scopedCacheFingerprints: [] }));
	});

	test(oneLine`
		sends no email for a notification whose transaction rolls back
	`, async () => {
		const database = knex.default({ client: MockClient });
		createTracker(database);
		vi.mocked(getDatabase).mockReturnValue(database);

		await expect(transaction(database, async (trx) => {
			await new NotificationsService({ knex: trx, schema })
				.createMany([{ recipient: 'user-a', subject: 'Hi' }]);

			throw new Error('second file refused');
		})).rejects.toEqual(new Error('second file refused'));

		expect(MailService.prototype.send).not.toHaveBeenCalled();
	});

	test(oneLine`
		sends the email of a notification once its transaction commits
	`, async () => {
		const database = knex.default({ client: MockClient });
		createTracker(database);
		vi.mocked(getDatabase).mockReturnValue(database);

		await transaction(database, async (trx) => {
			await new NotificationsService({ knex: trx, schema })
				.createMany([{ recipient: 'user-a', subject: 'Hi' }]);

			expect(MailService.prototype.send).not.toHaveBeenCalled();
		});

		// the transaction is complete by then: its email reads on the database
		expect(vi.mocked(UsersService).mock.calls).toEqual([
			[{ schema, knex: database }],
		]);

		expect(vi.mocked(MailService.prototype.send).mock.calls).toEqual([[{
			template: { name: 'base', data: { html: '' } },
			to: 'user-a@example.com',
			subject: 'Hi',
		}]]);
	});

	test(oneLine`
		sends the email of a notification created outside a transaction
	`, async () => {
		const database = knex.default({ client: MockClient });

		await new NotificationsService({ knex: database, schema })
			.createMany([{ recipient: 'user-a', subject: 'Hi' }]);

		expect(MailService.prototype.send).toHaveBeenCalledWith({
			template: { name: 'base', data: { html: '' } },
			to: 'user-a@example.com',
			subject: 'Hi',
		});
	});

	test(oneLine`
		emails the later notifications of a transaction when an earlier one fails
	`, async () => {
		const database = knex.default({ client: MockClient });
		createTracker(database);
		vi.mocked(getDatabase).mockReturnValue(database);
		const readError = new Error('user-a deleted');

		vi.spyOn(ItemsService.prototype, 'createMany')
			.mockImplementation(async (_data, opts) => {
				opts?.onItemsCreate?.([
					{
						primaryKey: 'notification-a',
						payload: { recipient: 'user-a', subject: 'A' },
					},
					{
						primaryKey: 'notification-b',
						payload: { recipient: 'user-b', subject: 'B' },
					},
				]);

				return ['notification-a', 'notification-b'];
			});

		vi.mocked(UsersService.prototype.readOne)
			.mockRejectedValueOnce(readError)
			.mockResolvedValueOnce(withMeta({
				id: 'user-b',
				email: 'user-b@example.com',
				email_notifications: true,
				role: null,
			}, { scopedCacheFingerprints: [] }));

		await transaction(database, async (trx) => {
			await new NotificationsService({ knex: trx, schema }).createMany([
				{ recipient: 'user-a', subject: 'A' },
				{ recipient: 'user-b', subject: 'B' },
			]);
		});

		const userFields = ['id', 'email', 'email_notifications', 'role'];

		expect(vi.mocked(UsersService.prototype.readOne).mock.calls).toEqual([
			['user-a', { fields: userFields }],
			['user-b', { fields: userFields }],
		]);

		expect(vi.mocked(MailService.prototype.send).mock.calls).toEqual([[{
			template: { name: 'base', data: { html: '' } },
			to: 'user-b@example.com',
			subject: 'B',
		}]]);

		expect(vi.mocked(useLogger().error).mock.calls).toEqual([
			[readError, 'Could not send notification via mail'],
		]);
	});

	test(oneLine`
		sends no email for a notification a filter hook cancelled
	`, async () => {
		const database = knex.default({ client: MockClient });

		vi.spyOn(ItemsService.prototype, 'createMany')
			.mockImplementation(async (_data, opts) => {
				opts?.onItemsCreate?.([{
					primaryKey: 'notification-b',
					payload: { recipient: 'user-a', subject: 'B' },
				}]);

				// the spy is typed off the overload without allowFilterCancel
				return [null, 'notification-b'] as never;
			});

		await new NotificationsService({ knex: database, schema }).createMany(
			[
				{ recipient: 'user-a', subject: 'A' },
				{ recipient: 'user-a', subject: 'B' },
			],
			{ allowFilterCancel: true },
		);

		expect(vi.mocked(MailService.prototype.send).mock.calls).toEqual([[{
			template: { name: 'base', data: { html: '' } },
			to: 'user-a@example.com',
			subject: 'B',
		}]]);
	});

	test(oneLine`
		sends no email for a notification a filter hook took over, nor twice for
		one written once for two positions
	`, async () => {
		const database = knex.default({ client: MockClient });

		vi.spyOn(ItemsService.prototype, 'createMany')
			.mockImplementation(async (_data, opts) => {
				opts?.onItemsCreate?.([{
					primaryKey: 'notification-b',
					payload: { recipient: 'user-a', subject: 'B' },
				}]);

				return ['notification-9', 'notification-b', 'notification-b'];
			});

		await new NotificationsService({ knex: database, schema }).createMany([
			{ recipient: 'user-a', subject: 'Stored' },
			{ recipient: 'user-a', subject: 'B' },
			{ recipient: 'user-a', subject: 'B' },
		]);

		expect(vi.mocked(MailService.prototype.send).mock.calls).toEqual([[{
			template: { name: 'base', data: { html: '' } },
			to: 'user-a@example.com',
			subject: 'B',
		}]]);
	});

	test(oneLine`
		emails a notification to the recipient a filter hook wrote
	`, async () => {
		const database = knex.default({ client: MockClient });

		vi.spyOn(ItemsService.prototype, 'createMany')
			.mockImplementation(async (_data, opts) => {
				opts?.onItemsCreate?.([{
					primaryKey: 'notification-a',
					payload: { recipient: 'user-b', subject: 'A' },
				}]);

				return ['notification-a'];
			});

		vi.mocked(UsersService.prototype.readOne).mockResolvedValue(withMeta({
			id: 'user-b',
			email: 'user-b@example.com',
			email_notifications: true,
			role: null,
		}, { scopedCacheFingerprints: [] }));

		await new NotificationsService({ knex: database, schema })
			.createMany([{ recipient: 'user-a', subject: 'A' }]);

		expect(vi.mocked(UsersService.prototype.readOne).mock.calls).toEqual([
			['user-b', { fields: ['id', 'email', 'email_notifications', 'role'] }],
		]);

		expect(vi.mocked(MailService.prototype.send).mock.calls).toEqual([[{
			template: { name: 'base', data: { html: '' } },
			to: 'user-b@example.com',
			subject: 'A',
		}]]);
	});

	test(oneLine`
		passes the rows a create wrote on to the caller's onItemsCreate
	`, async () => {
		const database = knex.default({ client: MockClient });
		const reportedItems: unknown[] = [];

		await new NotificationsService({ knex: database, schema }).createMany(
			[{ recipient: 'user-a', subject: 'Hi' }],
			{ onItemsCreate: (items) => reportedItems.push(items) },
		);

		expect(reportedItems).toEqual([[{
			primaryKey: 'notification-a',
			payload: { recipient: 'user-a', subject: 'Hi' },
		}]]);
	});
});
