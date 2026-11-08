import { oneLine } from '@directus/utils';
import knex from 'knex';
import { MockClient, createTracker } from 'knex-mock-client';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import getDatabase from '../database/index.js';
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
			.mockResolvedValue(['notification-a']);

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
});
