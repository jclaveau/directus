import { ForbiddenError } from '@directus/errors';
import { SchemaBuilder } from '@directus/schema-builder';
import type { Accountability, Relation } from '@directus/types';
import { oneLine } from '@directus/utils';
import knex from 'knex';
import type { Knex } from 'knex';
import { MockClient, Tracker, createTracker } from 'knex-mock-client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fetchAllowedFields } from '../permissions/modules/fetch-allowed-fields/fetch-allowed-fields.js';
import { validateAccess } from '../permissions/modules/validate-access/validate-access.js';
import { flushResponseCache } from '../scoped-cache/index.js';
import { freezeSchema } from '../utils/freeze-schema.js';
import { cloneDeep } from '../utils/lodash-es-used.js';
import { readMeta, withMeta } from '../utils/read-meta.js';
import { transaction } from '../utils/transaction.js';
import { ItemsService } from './items.js';
import { RelationsService } from './relations.js';

vi.mock('../../src/database/index', () => ({
	default: vi.fn(),
	getDatabaseClient: vi.fn().mockReturnValue('postgres'),
}));

vi.mock('../permissions/modules/validate-access/validate-access.js', () => ({
	validateAccess: vi.fn(),
}));

vi.mock('../permissions/modules/fetch-allowed-fields/fetch-allowed-fields.js', () => ({
	fetchAllowedFields: vi.fn(),
}));

vi.mock('../scoped-cache/index.js', async (importOriginal) => {
	return {
		...await importOriginal<typeof import('../scoped-cache/index.js')>(),
		flushResponseCache: vi.fn(),
	};
});

vi.mock('../utils/should-clear-cache.js', () => {
	return { shouldClearCache: vi.fn(() => true) };
});

vi.mock('../utils/transaction.js', () => {
	return {
		transaction: vi.fn((trxKnex, runInTransaction) => runInTransaction(trxKnex)),
	};
});

const schema = new SchemaBuilder()
	.collection('test', (c) => {
		c.field('id').uuid().primary();
		c.field('related').m2o('related');
		c.field('owner').uuid();
	})
	.collection('related', (c) => {
		c.field('id').uuid().primary();
	})
	.build();

const nonAdmin = { role: 'test', admin: false, user: 'test-user' } as Accountability;
const admin = { role: 'admin', admin: true, user: 'admin-user' } as Accountability;

class Client_PG extends MockClient {}

let db: Knex;
let tracker: Tracker;

beforeAll(() => {
	db = knex.default({ client: Client_PG });
	tracker = createTracker(db);
});

afterEach(() => {
	tracker.reset();
	vi.clearAllMocks();
});

describe('Services / Relations', () => {
	describe('createOne', () => {
		it('should throw ForbiddenError for non-admin user', async () => {
			const service = new RelationsService({ knex: db, schema, accountability: nonAdmin });

			await expect(service.createOne({ collection: 'test', field: 'related' })).rejects.toThrowError(ForbiddenError);

			await expect(service.createOne({ collection: 'test', field: 'related' })).rejects.toThrowError(
				`'test-user' is not allowed to create a relation`,
			);
		});

		it(oneLine`
			flushes the response cache: the scoped index is split by a path walked
			through relations, and a purge after the change would read other buckets
		`, async () => {
			vi.spyOn(ItemsService.prototype, 'createOne').mockResolvedValue(1);

			const service = new RelationsService({
				knex: db,
				schema,
				accountability: admin,
			});

			await service.createOne(
				{ collection: 'test', field: 'owner' },
				{ autoPurgeSystemCache: false },
			);

			expect(flushResponseCache).toHaveBeenCalledOnce();
		});

		it(oneLine`
			flushes nothing when the change rolled back: the relation it would have
			moved the index along never came to be
		`, async () => {
			vi.spyOn(ItemsService.prototype, 'createOne')
				.mockRejectedValue(new Error('insert or update violates foreign key'));

			const service = new RelationsService({
				knex: db,
				schema,
				accountability: admin,
			});

			await expect(service.createOne(
				{ collection: 'test', field: 'owner' },
				{ autoPurgeSystemCache: false },
			)).rejects.toThrow('insert or update violates foreign key');

			expect(flushResponseCache).not.toHaveBeenCalled();
		});

		it(oneLine`
			rejects when building the foreign key throws, rather than answering
			while the key is never created
		`, async () => {
			vi.spyOn(ItemsService.prototype, 'createOne').mockResolvedValue(1);
			const pgDatabase = knex.default({ client: MockClient, dialect: 'pg' });
			const pgTracker = createTracker(pgDatabase);
			pgTracker.on.any(/alter table/).response([]);

			vi.mocked(transaction).mockImplementationOnce((_knex, runInTransaction) => {
				return runInTransaction(pgDatabase as Knex.Transaction);
			});

			const servicePrototype = RelationsService.prototype as unknown as {
				alterType: () => void;
			};

			vi.spyOn(servicePrototype, 'alterType').mockImplementationOnce(() => {
				throw new Error('column "owner" cannot be cast');
			});

			const service = new RelationsService({
				knex: db,
				schema,
				accountability: admin,
			});

			await expect(service.createOne(
				{ collection: 'test', field: 'owner', related_collection: 'related' },
				{ autoPurgeSystemCache: false },
			)).rejects.toEqual(new Error('column "owner" cannot be cast'));
		});
	});

	describe('updateOne', () => {
		it('should throw ForbiddenError for non-admin user', async () => {
			const service = new RelationsService({ knex: db, schema, accountability: nonAdmin });

			await expect(service.updateOne('test', 'related', {})).rejects.toThrowError(ForbiddenError);

			await expect(service.updateOne('test', 'related', {})).rejects.toThrowError(
				`'test-user' is not allowed to update a relation`,
			);
		});

		it(oneLine`
			re-creates the foreign key it drops when handed a frozen schema, as the
			request that builds the schema cache is
		`, async () => {
			vi.spyOn(ItemsService.prototype, 'updateOne').mockResolvedValue(1);
			const pgDatabase = knex.default({ client: MockClient, dialect: 'pg' });
			const pgTracker = createTracker(pgDatabase);
			pgTracker.on.any(/alter table/).response([]);

			vi.mocked(transaction).mockImplementationOnce((_knex, runInTransaction) => {
				return runInTransaction(pgDatabase as Knex.Transaction);
			});

			const service = new RelationsService({
				knex: db,
				schema: freezeSchema(cloneDeep(schema)),
				accountability: admin,
			});

			await service.updateOne(
				'test',
				'related',
				{ schema: { on_delete: 'SET NULL' } } as Partial<Relation>,
				{ autoPurgeSystemCache: false },
			);

			expect(pgTracker.history.all).toMatchObject([
				{ sql: 'alter table "test" drop constraint "test_related_foreign"' },
				{
					sql: 'alter table "test" add constraint "test_related_foreign" '
						+ 'foreign key ("related") references "related" ("id") '
						+ 'on update NO ACTION on delete SET NULL',
				},
			]);
		});

		it('leaves the foreign key alone when handed the meta alone', async () => {
			vi.spyOn(ItemsService.prototype, 'updateOne').mockResolvedValue(1);
			const pgDatabase = knex.default({ client: MockClient, dialect: 'pg' });
			const pgTracker = createTracker(pgDatabase);
			pgTracker.on.any(/alter table/).response([]);

			vi.mocked(transaction).mockImplementationOnce((_knex, runInTransaction) => {
				return runInTransaction(pgDatabase as Knex.Transaction);
			});

			const service = new RelationsService({
				knex: db,
				schema,
				accountability: admin,
			});

			await service.updateOne(
				'test',
				'related',
				{ meta: { one_deselect_action: 'delete' } } as Partial<Relation>,
				{ autoPurgeSystemCache: false },
			);

			expect(pgTracker.history.all).toEqual([]);
		});

		it('keeps the foreign key action a partial schema leaves out', async () => {
			vi.spyOn(ItemsService.prototype, 'updateOne').mockResolvedValue(1);
			const pgDatabase = knex.default({ client: MockClient, dialect: 'pg' });
			const pgTracker = createTracker(pgDatabase);
			pgTracker.on.any(/alter table/).response([]);

			vi.mocked(transaction).mockImplementationOnce((_knex, runInTransaction) => {
				return runInTransaction(pgDatabase as Knex.Transaction);
			});

			const service = new RelationsService({
				knex: db,
				schema,
				accountability: admin,
			});

			await service.updateOne(
				'test',
				'related',
				{ schema: { on_update: 'CASCADE' } } as Partial<Relation>,
				{ autoPurgeSystemCache: false },
			);

			expect(pgTracker.history.all).toMatchObject([
				{ sql: 'alter table "test" drop constraint "test_related_foreign"' },
				{
					sql: 'alter table "test" add constraint "test_related_foreign" '
						+ 'foreign key ("related") references "related" ("id") '
						+ 'on update CASCADE on delete SET NULL',
				},
			]);
		});
	});

	describe('deleteOne', () => {
		it('should throw ForbiddenError for non-admin user', async () => {
			const service = new RelationsService({ knex: db, schema, accountability: nonAdmin });

			await expect(service.deleteOne('test', 'related')).rejects.toThrowError(ForbiddenError);

			await expect(service.deleteOne('test', 'related')).rejects.toThrowError(
				`'test-user' is not allowed to delete a relation`,
			);
		});
	});

	describe('readAll', () => {
		it('pins the result with directus_relations', async () => {
			vi.spyOn(ItemsService.prototype, 'readByQuery')
				.mockResolvedValue(withMeta([], { scopedCacheFingerprints: [] }));

			vi.spyOn(RelationsService.prototype, 'foreignKeys').mockResolvedValue([]);

			const service = new RelationsService({ knex: db, schema });
			const result = await service.readAll();

			expect(readMeta(result)?.scopedCacheFingerprints).toEqual([
				{ collection: 'directus_relations' },
			]);
		});
	});

	describe('readOne', () => {
		it('pins a found relation with directus_relations', async () => {
			vi.mocked(validateAccess).mockResolvedValue(undefined);
			vi.mocked(fetchAllowedFields).mockResolvedValue(['related']);

			vi.spyOn(ItemsService.prototype, 'readByQuery').mockResolvedValue(withMeta([
				{
					many_collection: 'test',
					many_field: 'related',
					one_collection: 'related',
				},
			], { scopedCacheFingerprints: [] }));

			vi.spyOn(RelationsService.prototype, 'foreignKeys').mockResolvedValue([
				{
					table: 'test',
					column: 'related',
					foreign_key_table: 'related',
					foreign_key_column: 'id',
				} as any,
			]);

			const service = new RelationsService({
				knex: db,
				schema,
				accountability: admin,
			});

			const result = await service.readOne('test', 'related');

			expect(readMeta(result)?.scopedCacheFingerprints).toEqual([
				{ collection: 'directus_relations' },
			]);
		});

		it('should throw ForbiddenError when non-admin lacks field read permission', async () => {
			vi.mocked(validateAccess).mockResolvedValue(undefined);
			vi.mocked(fetchAllowedFields).mockResolvedValue(['id']);

			const service = new RelationsService({ knex: db, schema, accountability: nonAdmin });

			await expect(service.readOne('test', 'related')).rejects.toThrowError(ForbiddenError);

			await expect(service.readOne('test', 'related')).rejects.toThrowError(
				`'test-user' has no permission to read the field 'related' of 'test'`,
			);
		});

		it('should throw ForbiddenError when no relation is found', async () => {
			vi.spyOn(ItemsService.prototype, 'readByQuery')
				.mockResolvedValue(withMeta([], { scopedCacheFingerprints: [] }));

			vi.spyOn(RelationsService.prototype, 'foreignKeys').mockResolvedValue([]);

			const service = new RelationsService({ knex: db, schema, accountability: admin });

			await expect(service.readOne('test', 'related')).rejects.toThrowError(ForbiddenError);

			await expect(service.readOne('test', 'related')).rejects.toThrowError(
				`No result found for relation test.related during items.readOne()`,
			);
		});
	});
});
