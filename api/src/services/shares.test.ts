import { ForbiddenError } from '@directus/errors';
import { SchemaBuilder } from '@directus/schema-builder';
import type { Accountability } from '@directus/types';
import knex, { type Knex } from 'knex';
import { MockClient, Tracker, createTracker } from 'knex-mock-client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SharesService } from './shares.js';

vi.mock('../../src/database/index', () => ({
	default: vi.fn(),
	getDatabaseClient: vi.fn().mockReturnValue('postgres'),
}));

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
	});
});
