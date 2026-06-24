import { ForbiddenError } from '@directus/errors';
import { SchemaBuilder } from '@directus/schema-builder';
import type { Accountability } from '@directus/types';
import knex, { type Knex } from 'knex';
import { MockClient, Tracker, createTracker } from 'knex-mock-client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fetchAllowedFields } from '../permissions/modules/fetch-allowed-fields/fetch-allowed-fields.js';
import { validateAccess } from '../permissions/modules/validate-access/validate-access.js';
import { UtilsService } from './utils.js';

vi.mock('../../src/database/index', () => ({
	default: vi.fn(),
	getDatabaseClient: vi.fn().mockReturnValue('postgres'),
}));

vi.mock('../permissions/modules/validate-access/validate-access.js');
vi.mock('../permissions/modules/fetch-allowed-fields/fetch-allowed-fields.js');

const schema = new SchemaBuilder()
	.collection('test', (c) => {
		c.field('id').id();
		c.field('sort').integer();
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

describe('Services / Utils', () => {
	describe('sort', () => {
		it('should throw ForbiddenError when non-admin lacks read permission on the sort field', async () => {
			tracker.on.select('directus_collections').response({ sort_field: 'sort' });

			vi.mocked(validateAccess).mockResolvedValue(undefined);
			vi.mocked(fetchAllowedFields).mockResolvedValue(['id']);

			const service = new UtilsService({
				knex: db,
				schema,
				accountability: { user: 'test-user', admin: false } as Accountability,
			});

			await expect(service.sort('test', { item: 1, to: 2 })).rejects.toThrowError(ForbiddenError);

			await expect(service.sort('test', { item: 1, to: 2 })).rejects.toThrowError(
				`'test-user' does not have permission to read the sort field 'test.sort'`,
			);
		});
	});

	describe('clearCache', () => {
		it('should throw ForbiddenError for non-admin user', async () => {
			const service = new UtilsService({
				knex: db,
				schema,
				accountability: { user: 'test-user', admin: false } as Accountability,
			});

			await expect(service.clearCache({ system: false })).rejects.toThrowError(ForbiddenError);

			await expect(service.clearCache({ system: false })).rejects.toThrowError(
				`'test-user' does not have permission to clear the cache as not being an admin`,
			);
		});
	});
});
