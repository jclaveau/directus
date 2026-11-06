import { InvalidPayloadError } from '@directus/errors';
import { SchemaBuilder } from '@directus/schema-builder';
import knex, { type Knex } from 'knex';
import { MockClient, Tracker, createTracker } from 'knex-mock-client';
import {
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
	vi,
} from 'vitest';
import { getService } from '../utils/get-service.js';
import { type ItemsService, PayloadService } from './index.js';

vi.mock('../../src/database/index', () => {
	return { getDatabaseClient: vi.fn().mockReturnValue('postgres') };
});

vi.mock('../utils/get-service.js', () => ({ getService: vi.fn() }));

let db: Knex;
let tracker: Tracker;

beforeAll(() => {
	db = knex.default({ client: MockClient });
	tracker = createTracker(db);
});

afterEach(() => {
	tracker.reset();
	vi.mocked(getService).mockReset();
	vi.restoreAllMocks();
});

describe('processA2O', () => {
	const schema = new SchemaBuilder()
		.collection('comment', (c) => {
			c.field('id').id();
			c.field('item').a2o(['post', 'page']);
			c.field('author').m2o('person');
		})
		.build();

	test('creates a nested record that has no primary key', async () => {
		const upsertManySpy = vi.fn().mockResolvedValue([11]);

		vi.mocked(getService).mockReturnValue({
			upsertMany: upsertManySpy,
		} as unknown as ItemsService);

		const service = new PayloadService('comment', { knex: db, schema });

		const result = await service.processA2O([{
			collection: 'post',
			item: { title: 'Hello' },
		}]);

		expect(getService).toHaveBeenCalledWith('post', {
			accountability: null,
			knex: db,
			schema,
			nested: ['item'],
		});

		expect(upsertManySpy).toHaveBeenCalledWith(
			[{ title: 'Hello' }],
			{
				refuseHookAddedRows: true,
				onRevisionCreate: expect.any(Function),
				onRequireUserIntegrityCheck: expect.any(Function),
				bypassEmitAction: expect.any(Function),
				emitEvents: undefined,
				mutationTracker: undefined,
			},
		);

		expect(result.payloads).toStrictEqual([{ collection: 'post', item: 11 }]);
	});

	test('upserts a nested record that has fields beside its key', async () => {
		const upsertManySpy = vi.fn().mockResolvedValue([5]);

		vi.mocked(getService).mockReturnValue({
			upsertMany: upsertManySpy,
		} as unknown as ItemsService);

		const service = new PayloadService('comment', { knex: db, schema });

		const result = await service.processA2O([{
			collection: 'post',
			item: { id: 5, title: 'Hello' },
		}]);

		expect(tracker.history.select).toEqual([]);

		expect(upsertManySpy).toHaveBeenCalledWith(
			[{ id: 5, title: 'Hello' }],
			expect.any(Object),
		);

		expect(result.payloads).toStrictEqual([{ collection: 'post', item: 5 }]);
	});

	test('links a record holding only the key of a row, writing nothing', async () => {
		tracker.on.select('post').response([{ id: 5 }]);
		const upsertManySpy = vi.fn();

		vi.mocked(getService).mockReturnValue({
			upsertMany: upsertManySpy,
		} as unknown as ItemsService);

		const service = new PayloadService('comment', { knex: db, schema });

		const result = await service.processA2O([{
			collection: 'post',
			item: { id: 5 },
		}]);

		expect(upsertManySpy).not.toHaveBeenCalled();
		expect(result.payloads).toStrictEqual([{ collection: 'post', item: 5 }]);
	});

	test('creates a nested record holding only a key no row has', async () => {
		tracker.on.select('post').response([]);
		const upsertManySpy = vi.fn().mockResolvedValue([5]);

		vi.mocked(getService).mockReturnValue({
			upsertMany: upsertManySpy,
		} as unknown as ItemsService);

		const service = new PayloadService('comment', { knex: db, schema });

		const result = await service.processA2O([{
			collection: 'post',
			item: { id: 5 },
		}]);

		expect(upsertManySpy).toHaveBeenCalledWith(
			[{ id: 5 }],
			expect.any(Object),
		);

		expect(result.payloads).toStrictEqual([{ collection: 'post', item: 5 }]);
	});

	test('leaves a nested m2o record to processM2O', async () => {
		const service = new PayloadService('comment', { knex: db, schema });

		const result = await service.processA2O([{ author: { name: 'Ada' } }]);

		expect(getService).not.toHaveBeenCalled();
		expect(result.payloads).toStrictEqual([{ author: { name: 'Ada' } }]);
	});

	test('refuses a nested record without its collection field', async () => {
		const service = new PayloadService('comment', { knex: db, schema });

		await expect(
			service.processA2O([{ item: { title: 'Hello' } }]),
		).rejects.toStrictEqual(new InvalidPayloadError({
			reason: 'Can\'t update nested record "comment.item" without'
				+ ' field "comment.collection" being set',
		}));
	});

	test('refuses a nested record of a collection not allowed', async () => {
		const service = new PayloadService('comment', { knex: db, schema });

		await expect(
			service.processA2O([{ collection: 'video', item: { title: 'Hello' } }]),
		).rejects.toStrictEqual(new InvalidPayloadError({
			reason: '"comment.item" can\'t be linked to collection "video"',
		}));
	});

	test('refuses a nested record naming its collection by a list', async () => {
		const service = new PayloadService('comment', { knex: db, schema });

		await expect(
			service.processA2O([{ collection: ['post'], item: { title: 'Hello' } }]),
		).rejects.toStrictEqual(new InvalidPayloadError({
			reason: '"comment.item" can\'t be linked to collection ["post"]',
		}));
	});

	test('refuses a single row passed without its array', async () => {
		const service = new PayloadService('comment', { knex: db, schema });

		await expect(
			service.processA2O({ collection: 'post' } as never),
		).rejects.toStrictEqual(new Error(
			'processA2O takes the rows as an array, got {"collection":"post"}',
		));
	});

	test('refuses a revision upsertMany files under no nested record', async () => {
		vi.mocked(getService).mockReturnValue({
			upsertMany: vi.fn().mockImplementation((_records, opts) => {
				opts.onRevisionCreate(21, 7, undefined);
			}),
		} as unknown as ItemsService);

		const service = new PayloadService('comment', { knex: db, schema });

		await expect(service.processA2O([{
			collection: 'post',
			item: { title: 'Hello' },
		}])).rejects.toStrictEqual(new Error(
			'Revision 21 of 7 in "post" came from no nested record',
		));
	});
});

describe('processM2O', () => {
	const schema = new SchemaBuilder()
		.collection('city', (c) => {
			c.field('id').id();
			c.field('country').m2o('country');
		})
		.build();

	test('upserts the nested records of every row in one call', async () => {
		const upsertManySpy = vi.fn().mockResolvedValue([3, 4]);

		vi.mocked(getService).mockReturnValue({
			upsertMany: upsertManySpy,
		} as unknown as ItemsService);

		const service = new PayloadService('city', { knex: db, schema });

		const result = await service.processM2O([
			{ country: { id: 3, name: 'France' } },
			{ country: { name: 'Spain' } },
		]);

		expect(upsertManySpy).toHaveBeenCalledWith(
			[{ id: 3, name: 'France' }, { name: 'Spain' }],
			{
				refuseHookAddedRows: true,
				onRevisionCreate: expect.any(Function),
				onRequireUserIntegrityCheck: expect.any(Function),
				bypassEmitAction: expect.any(Function),
				emitEvents: undefined,
				mutationTracker: undefined,
			},
		);

		expect(result.payloads).toStrictEqual([{ country: 3 }, { country: 4 }]);
	});

	test('refuses a single row passed without its array', async () => {
		const service = new PayloadService('city', { knex: db, schema });

		await expect(
			service.processM2O({ country: 3 } as never),
		).rejects.toStrictEqual(new Error(
			'processM2O takes the rows as an array, got {"country":3}',
		));
	});
});

describe('processO2M', () => {
	const schema = new SchemaBuilder()
		.collection('country', (c) => {
			c.field('id').id();
			c.field('cities').o2m('city', 'country_id');
		})
		.collection('city', (c) => {
			c.field('id').id();
			c.field('name').string();
			c.field('country_id').integer();
		})
		.build();

	test('keeps the parent of a record given as an object', async () => {
		tracker.on.select('city').response([{ id: 4, country_id: 1 }]);
		const upsertManySpy = vi.fn().mockResolvedValue([4]);

		vi.mocked(getService).mockReturnValue({
			upsertMany: upsertManySpy,
			updateByQuery: vi.fn().mockResolvedValue([]),
		} as unknown as ItemsService);

		const service = new PayloadService('country', { knex: db, schema });

		await service.processO2M([
			{ data: { cities: [{ id: 4, name: 'Lyon' }] }, key: 1 },
		]);

		expect(upsertManySpy).toHaveBeenCalledWith(
			[{ id: 4, name: 'Lyon' }],
			expect.any(Object),
		);
	});

	test('moves an updated record from another parent', async () => {
		tracker.on.select('city').response([{ id: 4, country_id: 2 }]);
		const updateOneSpy = vi.fn().mockResolvedValue(4);

		vi.mocked(getService).mockReturnValue({
			updateOne: updateOneSpy,
		} as unknown as ItemsService);

		await new PayloadService('country', { knex: db, schema }).processO2M([
			{ data: { cities: { update: [{ id: 4, name: 'Lyon' }] } }, key: 1 },
		]);

		expect(updateOneSpy).toHaveBeenCalledWith(
			4,
			{ name: 'Lyon', country_id: 1 },
			expect.any(Object),
		);
	});

	test('keeps the parent of a record it already belongs to', async () => {
		tracker.on.select('city').response([{ id: 4, country_id: 1 }]);
		const updateOneSpy = vi.fn().mockResolvedValue(4);

		vi.mocked(getService).mockReturnValue({
			updateOne: updateOneSpy,
		} as unknown as ItemsService);

		await new PayloadService('country', { knex: db, schema }).processO2M([
			{ data: { cities: { update: [{ id: 4, name: 'Lyon' }] } }, key: 1 },
		]);

		expect(updateOneSpy).toHaveBeenCalledWith(
			4,
			{ name: 'Lyon' },
			expect.any(Object),
		);
	});

	test('skips a record given by its key that already belongs to it', async () => {
		tracker.on.select('city').response([{ id: 4, country_id: 1 }]);
		const upsertManySpy = vi.fn().mockResolvedValue([]);

		vi.mocked(getService).mockReturnValue({
			upsertMany: upsertManySpy,
			updateByQuery: vi.fn().mockResolvedValue([]),
		} as unknown as ItemsService);

		await new PayloadService('country', { knex: db, schema })
			.processO2M([{ data: { cities: [4] }, key: 1 }]);

		expect(upsertManySpy).toHaveBeenCalledWith([], expect.any(Object));
	});

	test('moves a record given by its key from another parent', async () => {
		tracker.on.select('city').response([{ id: 4, country_id: 2 }]);
		const upsertManySpy = vi.fn().mockResolvedValue([4]);

		vi.mocked(getService).mockReturnValue({
			upsertMany: upsertManySpy,
			updateByQuery: vi.fn().mockResolvedValue([]),
		} as unknown as ItemsService);

		await new PayloadService('country', { knex: db, schema })
			.processO2M([{ data: { cities: [4] }, key: 1 }]);

		expect(upsertManySpy).toHaveBeenCalledWith(
			[{ id: 4, country_id: 1 }],
			expect.any(Object),
		);
	});

	test('sorts a created record last unless it carries a sort', async () => {
		const sortedSchema = new SchemaBuilder()
			.collection('country', (c) => {
				c.field('id').id();
				c.field('cities').o2m('city', 'country_id');
			})
			.collection('city', (c) => {
				c.field('id').id();
				c.field('name').string();
				c.field('sort').integer();
				c.field('country_id').integer();
			})
			.build();

		sortedSchema.relations[0]!.meta!.sort_field = 'sort';

		tracker.on.select('city').response([{ max: 3 }]);
		const createManySpy = vi.fn().mockResolvedValue([5, 6]);

		vi.mocked(getService).mockReturnValue({
			createMany: createManySpy,
		} as unknown as ItemsService);

		await new PayloadService('country', { knex: db, schema: sortedSchema })
			.processO2M([{
				data: {
					cities: {
						create: [{ name: 'Lyon' }, { name: 'Nice', sort: 1 }],
					},
				},
				key: 1,
			}]);

		expect(createManySpy).toHaveBeenCalledWith(
			[
				{ name: 'Lyon', sort: 4, country_id: 1 },
				{ name: 'Nice', sort: 1, country_id: 1 },
			],
			expect.any(Object),
		);
	});
});
