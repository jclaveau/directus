import { SchemaBuilder } from '@directus/schema-builder';
import { oneLine } from '@directus/utils';
import knex from 'knex';
import { MockClient, createTracker } from 'knex-mock-client';
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
	vi,
} from 'vitest';
import { CapabilitiesHelper } from '../database/helpers/capabilities/types.js';
import getDatabase from '../database/index.js';
import emitter from '../emitter.js';
import { useLogger } from '../logger/index.js';
import { withMeta } from '../utils/read-meta.js';
import { transaction } from '../utils/transaction.js';
import { MailService } from './mail/index.js';
import {
	NotificationsService,
	initNotificationEmails,
} from './notifications.js';
import { UsersService } from './users.js';

vi.mock('../database/index.js', () => {
	return { default: vi.fn(), getDatabaseClient: vi.fn(() => 'postgres') };
});

vi.mock('@directus/env', () => {
	return {
		useEnv: vi.fn(() => {
			return {
				PUBLIC_URL: 'http://example.com',
				CACHE_AUTO_PURGE: false,
				MAX_BATCH_MUTATION: 100000,
			};
		}),
	};
});

vi.mock('../cache.js', () => {
	return {
		getCache: () => ({ cache: undefined }),
		clearSystemCache: vi.fn(),
	};
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

const schema = new SchemaBuilder()
	.collection('directus_notifications', (c) => {
		c.field('id').id();
		c.field('recipient').string();
		c.field('subject').string();
	})
	.build();

const database = knex.default({ client: MockClient });
const tracker = createTracker(database);

describe('notification emails', () => {
	beforeAll(() => {
		initNotificationEmails();
	});

	beforeEach(() => {
		vi.mocked(getDatabase).mockReturnValue(database);

		// this MockClient compiles no FOR UPDATE
		vi.spyOn(CapabilitiesHelper.prototype, 'supportsRowLocks')
			.mockReturnValue(false);

		vi.mocked(UsersService.prototype.readOne).mockResolvedValue(withMeta({
			id: 'user-a',
			email: 'user-a@example.com',
			email_notifications: true,
			role: null,
		}, { scopedCacheFingerprints: [] }));
	});

	afterEach(() => {
		tracker.reset();
		vi.clearAllMocks();
	});

	test(oneLine`
		emails a notification once the create that wrote it commits
	`, async () => {
		tracker.on.insert('directus_notifications').response([1]);

		await new NotificationsService({ knex: database, schema })
			.createMany([{ recipient: 'user-a', subject: 'Hi' }]);

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
		sends no email for a notification whose caller's transaction rolls back
	`, async () => {
		tracker.on.insert('directus_notifications').response([1]);

		await expect(transaction(database, async (trx) => {
			await new NotificationsService({ knex: trx, schema })
				.createMany([{ recipient: 'user-a', subject: 'Hi' }]);

			throw new Error('title refused');
		})).rejects.toEqual(new Error('title refused'));

		expect(MailService.prototype.send).not.toHaveBeenCalled();
	});

	test(oneLine`
		holds the email of a notification until its caller's transaction commits
	`, async () => {
		tracker.on.insert('directus_notifications').response([1]);

		await transaction(database, async (trx) => {
			await new NotificationsService({ knex: trx, schema })
				.createMany([{ recipient: 'user-a', subject: 'Hi' }]);

			expect(MailService.prototype.send).not.toHaveBeenCalled();
		});

		expect(vi.mocked(MailService.prototype.send).mock.calls).toEqual([[{
			template: { name: 'base', data: { html: '' } },
			to: 'user-a@example.com',
			subject: 'Hi',
		}]]);
	});

	test(oneLine`
		emails only the rows a create wrote, as written: none for a row a filter
		hook took over, pointed at another or cancelled
	`, async () => {
		tracker.on.insert('directus_notifications').response([1]);

		const reshapeRows = () => {
			return [
				{ data: { recipient: 'user-b', subject: 'A' } },
				{ key: 9 },
				{ sameRowAs: 0 },
				null,
			];
		};

		emitter.onFilter('notifications.create', reshapeRows);

		vi.mocked(UsersService.prototype.readOne).mockResolvedValue(withMeta({
			id: 'user-b',
			email: 'user-b@example.com',
			email_notifications: true,
			role: null,
		}, { scopedCacheFingerprints: [] }));

		try {
			const keys = await new NotificationsService({ knex: database, schema })
				.createMany(
					[
						{ recipient: 'user-a', subject: 'A' },
						{ recipient: 'user-a', subject: 'Stored' },
						{ recipient: 'user-a', subject: 'A' },
						{ recipient: 'user-a', subject: 'B' },
					],
					{ allowFilterCancel: true },
				);

			expect(keys).toEqual([1, 9, 1, null]);
		}
		finally {
			emitter.offFilter('notifications.create', reshapeRows);
		}

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
		emails the later notifications of a create when an earlier one fails
	`, async () => {
		tracker.on.insert('directus_notifications').response([1, 2]);
		const readError = new Error('user-a deleted');

		vi.mocked(UsersService.prototype.readOne)
			.mockRejectedValueOnce(readError)
			.mockResolvedValueOnce(withMeta({
				id: 'user-b',
				email: 'user-b@example.com',
				email_notifications: true,
				role: null,
			}, { scopedCacheFingerprints: [] }));

		await new NotificationsService({ knex: database, schema }).createMany([
			{ recipient: 'user-a', subject: 'A' },
			{ recipient: 'user-b', subject: 'B' },
		]);

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
		emails a notification whose recipient is sent as an object
	`, async () => {
		tracker.on.insert('directus_notifications').response([1]);

		await new NotificationsService({ knex: database, schema })
			.createMany([{ recipient: { id: 'user-a' } as never, subject: 'A' }]);

		expect(vi.mocked(UsersService.prototype.readOne).mock.calls).toEqual([
			['user-a', { fields: ['id', 'email', 'email_notifications', 'role'] }],
		]);

		expect(vi.mocked(MailService.prototype.send).mock.calls).toEqual([[{
			template: { name: 'base', data: { html: '' } },
			to: 'user-a@example.com',
			subject: 'A',
		}]]);
	});

	test(oneLine`
		sends no email for a create that emits no events
	`, async () => {
		tracker.on.insert('directus_notifications').response([1]);

		await new NotificationsService({ knex: database, schema }).createMany(
			[{ recipient: 'user-a', subject: 'Hi' }],
			{ emitEvents: false },
		);

		expect(MailService.prototype.send).not.toHaveBeenCalled();
	});

	test(oneLine`
		emails at once the notifications a created hook is handed outside a
		transaction
	`, async () => {
		await emitter.emitWrittenFilter(
			'notifications.created',
			[{ id: 1, recipient: 'user-a', subject: 'Hi' }],
			{ keys: [1], collection: 'directus_notifications' },
			{
				transaction: database,
				database,
				schema,
				accountability: null,
				scopedCache: { purgeBy: vi.fn() },
			},
		);

		expect(vi.mocked(MailService.prototype.send).mock.calls).toEqual([[{
			template: { name: 'base', data: { html: '' } },
			to: 'user-a@example.com',
			subject: 'Hi',
		}]]);
	});
});
