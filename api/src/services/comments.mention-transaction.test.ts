import { SchemaBuilder } from '@directus/schema-builder';
import type { Accountability, ActionEventParams } from '@directus/types';
import { oneLine } from '@directus/utils';
import knex, { type Knex } from 'knex';
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
import getDatabase, {
	getDatabaseForAccountability,
} from '../database/index.js';
import emitter from '../emitter.js';
import { withMeta } from '../utils/read-meta.js';
import { transaction } from '../utils/transaction.js';
import { CommentsService } from './comments.js';
import { MailService } from './mail/index.js';
import { initNotificationEmails } from './notifications.js';
import { UsersService } from './users.js';

vi.mock('../database/index.js', () => {
	return {
		default: vi.fn(),
		getDatabaseForAccountability: vi.fn(),
		getDatabaseClient: vi.fn(() => 'postgres'),
	};
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
	() => {
		return {
			fetchGlobalAccess: vi.fn().mockResolvedValue({
				admin: true,
				app: false,
			}),
		};
	},
);

vi.mock(
	'../permissions/modules/validate-access/validate-access.js',
	() => ({ validateAccess: vi.fn().mockResolvedValue(undefined) }),
);

vi.mock('./mail/index.js', () => {
	const MailService = vi.fn();
	MailService.prototype.send = vi.fn().mockResolvedValue(undefined);
	return { MailService };
});

vi.mock('./users.js', () => {
	const UsersService = vi.fn();
	UsersService.prototype.readOne = vi.fn();
	UsersService.prototype.readByQuery = vi.fn();
	return { UsersService };
});

const schema = new SchemaBuilder()
	.collection('directus_comments', (c) => {
		c.field('id').id();
		c.field('collection').string();
		c.field('item').string();
		c.field('comment').string();
	})
	.collection('directus_notifications', (c) => {
		c.field('id').id();
		c.field('recipient').string();
		c.field('sender').string();
		c.field('subject').string();
		c.field('message').string();
		c.field('collection').string();
		c.field('item').string();
	})
	.build();

schema.collections['directus_comments']!.accountability = null;
schema.collections['directus_notifications']!.accountability = null;

const author: Accountability = {
	user: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
	role: null,
	admin: true,
	app: true,
	roles: [],
	ip: null,
};

const database = knex.default({ client: MockClient });
const tracker = createTracker(database);

describe('a comment mention in its caller\'s transaction', () => {
	const notificationActionListener = vi.fn();

	beforeAll(() => {
		initNotificationEmails();
		emitter.onAction('notifications.create', notificationActionListener);
	});

	beforeEach(() => {
		vi.mocked(getDatabase).mockReturnValue(database);
		vi.mocked(getDatabaseForAccountability).mockReturnValue(database);
		tracker.on.insert('directus_comments').response([1]);
		tracker.on.insert('directus_notifications').response([7]);

		vi.mocked(UsersService.prototype.readByQuery).mockResolvedValue(withMeta([{
			id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
			first_name: 'Jane',
			last_name: 'Doe',
		}], { scopedCacheFingerprints: [] }));

		vi.mocked(UsersService.prototype.readOne)
			.mockResolvedValueOnce(withMeta({
				id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
				first_name: 'Sam',
				last_name: 'Sender',
			}, { scopedCacheFingerprints: [] }))
			.mockResolvedValue(withMeta({
				id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
				first_name: 'Jane',
				last_name: 'Doe',
				email: 'jane@example.com',
				email_notifications: true,
				role: null,
			}, { scopedCacheFingerprints: [] }));
	});

	afterEach(() => {
		tracker.reset();
		vi.clearAllMocks();
	});

	test(oneLine`
		sends no email and fires no notification action when the caller's
		transaction rolls back
	`, async () => {
		const heldActionEvents: ActionEventParams[] = [];

		await expect(transaction(database, async (trx) => {
			await new CommentsService({ knex: trx, schema, accountability: author })
				.createMany(
					[{
						comment: 'hey @aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
						collection: 'articles',
						item: '42',
					}],
					{
						bypassEmitAction: (actionEvent) => {
							heldActionEvents.push(actionEvent);
						},
					},
				);

			throw new Error('file 2 refused');
		})).rejects.toEqual(new Error('file 2 refused'));

		expect(MailService.prototype.send).not.toHaveBeenCalled();
		expect(notificationActionListener).not.toHaveBeenCalled();
	});

	test(oneLine`
		reads the users of a mention on the caller's transaction
	`, async () => {
		let callerTransaction: Knex | undefined;

		await transaction(database, async (trx) => {
			callerTransaction = trx;

			await new CommentsService({ knex: trx, schema, accountability: author })
				.createMany([{
					comment: 'hey @aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
					collection: 'articles',
					item: '42',
				}]);
		});

		expect(vi.mocked(UsersService).mock.calls).toEqual([
			[{ schema, knex: callerTransaction }],
			[{ schema, knex: callerTransaction, accountability: author }],
			[{
				schema,
				knex: callerTransaction,
				accountability: {
					user: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
					role: null,
					admin: true,
					app: false,
					roles: [],
					ip: null,
				},
			}],
			[{ schema, knex: database }],
		]);
	});

	test(oneLine`
		hands the notification action to the caller's bypassEmitAction and emails
		the mention once the caller's transaction commits
	`, async () => {
		const heldActionEvents: ActionEventParams[] = [];

		await transaction(database, async (trx) => {
			await new CommentsService({ knex: trx, schema, accountability: author })
				.createMany(
					[{
						comment: 'hey @aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
						collection: 'articles',
						item: '42',
					}],
					{
						bypassEmitAction: (actionEvent) => {
							heldActionEvents.push(actionEvent);
						},
					},
				);

			expect(MailService.prototype.send).not.toHaveBeenCalled();
		});

		expect(notificationActionListener).not.toHaveBeenCalled();

		expect(heldActionEvents).toEqual([
			{
				event: 'comments.create',
				meta: {
					payload: [{
						id: 1,
						comment: 'hey @aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
						collection: 'articles',
						item: '42',
					}],
					keys: [1],
					collection: 'directus_comments',
				},
				context: { database, schema, accountability: author },
			},
			{
				event: 'notifications.create',
				meta: {
					payload: [{
						id: 7,
						recipient: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
						sender: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
						subject: 'You were mentioned in articles',
						message: `
Hello Jane Doe,

Sam Sender has mentioned you in a comment:

> hey <em>Jane Doe</em>

<a href="http://example.com/admin/content/articles/42">Click here to view.</a>
`,
						collection: 'articles',
						item: '42',
					}],
					keys: [7],
					collection: 'directus_notifications',
				},
				context: { database, schema, accountability: null },
			},
		]);

		expect(vi.mocked(MailService.prototype.send).mock.calls).toEqual([[{
			template: {
				name: 'base',
				data: {
					html: `<p>Hello Jane Doe,</p>
<p>Sam Sender has mentioned you in a comment:</p>
<blockquote>
<p>hey <em>Jane Doe</em></p>
</blockquote>
<p><a href="http://example.com/admin/content/articles/42">Click here to view.</a></p>
`,
				},
			},
			to: 'jane@example.com',
			subject: 'You were mentioned in articles',
		}]]);
	});
});
