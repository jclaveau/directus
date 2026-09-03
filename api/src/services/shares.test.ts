import { ForbiddenError } from '@directus/errors';
import { SchemaBuilder } from '@directus/schema-builder';
import type { Accountability } from '@directus/types';
import knex, { type Knex } from 'knex';
import { MockClient, Tracker, createTracker } from 'knex-mock-client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readResult } from '../__utils__/read-result.js';
import { ItemsService } from './items.js';
import type { EmailOptions } from './mail/index.js';
import { SharesService } from './shares.js';

vi.mock('../../src/database/index', () => ({
	default: vi.fn(),
	getDatabaseClient: vi.fn().mockReturnValue('postgres'),
}));

const { send } = vi.hoisted(() => {
	return { send: vi.fn(async (_options: EmailOptions): Promise<null> => null) };
});

vi.mock('./mail/index.js', () => {
	return {
		MailService: vi.fn(() => {
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
	vi.clearAllMocks();
});

describe('Services / Shares', () => {
	describe('invite', () => {
		it('should throw ForbiddenError when accountability has no user', async () => {
			const service = new SharesService({ knex: db, schema, accountability: {} as Accountability });

			await expect(service.invite({ emails: ['test@example.com'], share: 1 })).rejects.toThrowError(ForbiddenError);

			await expect(service.invite({ emails: ['test@example.com'], share: 1 })).rejects.toThrowError(
				'You must be authenticated to send a share invite.',
			);
		});

		// Last, since the `readOne` spy survives clearAllMocks and would otherwise
		// answer the reads of any test appended after it.
		it('mails every invitee a link naming the sender', async () => {
			const readOne = vi.spyOn(ItemsService.prototype, 'readOne');

			readOne.mockResolvedValueOnce(readResult({ collection: 'articles' }));

			readOne.mockResolvedValueOnce(
				readResult({ first_name: 'Ada', last_name: 'Lovelace' }),
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
