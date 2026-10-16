import { InvalidPayloadError } from '@directus/errors';
import { SchemaBuilder } from '@directus/schema-builder';
import type { PrimaryKey } from '@directus/types';
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
		const createOneSpy = vi.fn().mockResolvedValue(11);

		vi.mocked(getService).mockReturnValue({
			createOne: createOneSpy,
		} as unknown as ItemsService);

		const service = new PayloadService('comment', { knex: db, schema });

		const result = await service.processA2O({
			collection: 'post',
			item: { title: 'Hello' },
		});

		expect(getService).toHaveBeenCalledWith('post', {
			accountability: null,
			knex: db,
			schema,
			nested: ['item'],
		});

		expect(createOneSpy).toHaveBeenCalledWith(
			{ title: 'Hello' },
			expect.any(Object),
		);

		expect(result.payload).toEqual({ collection: 'post', item: 11 });
	});

	test('updates a nested record whose primary key exists', async () => {
		tracker.on.select('post').response([{ id: 5 }]);
		const updateOneSpy = vi.fn().mockResolvedValue(5);

		vi.mocked(getService).mockReturnValue({
			updateOne: updateOneSpy,
		} as unknown as ItemsService);

		const service = new PayloadService('comment', { knex: db, schema });

		const result = await service.processA2O({
			collection: 'post',
			item: { id: 5, title: 'Hello' },
		});

		expect(updateOneSpy).toHaveBeenCalledWith(
			5,
			{ title: 'Hello' },
			expect.any(Object),
		);

		expect(result.payload).toEqual({ collection: 'post', item: 5 });
	});

	test('creates a nested record whose primary key is unknown', async () => {
		tracker.on.select('post').response([]);
		const createOneSpy = vi.fn().mockResolvedValue(5);

		vi.mocked(getService).mockReturnValue({
			createOne: createOneSpy,
		} as unknown as ItemsService);

		const service = new PayloadService('comment', { knex: db, schema });

		const result = await service.processA2O({
			collection: 'post',
			item: { id: 5, title: 'Hello' },
		});

		expect(createOneSpy).toHaveBeenCalledWith(
			{ id: 5, title: 'Hello' },
			expect.any(Object),
		);

		expect(result.payload).toEqual({ collection: 'post', item: 5 });
	});

	test('leaves a nested m2o record to processM2O', async () => {
		const service = new PayloadService('comment', { knex: db, schema });

		const result = await service.processA2O({ author: { name: 'Ada' } });

		expect(getService).not.toHaveBeenCalled();
		expect(result.payload).toEqual({ author: { name: 'Ada' } });
	});

	test('refuses a nested record without its collection field', async () => {
		const service = new PayloadService('comment', { knex: db, schema });

		await expect(
			service.processA2O({ item: { title: 'Hello' } }),
		).rejects.toThrowError(InvalidPayloadError);

		await expect(
			service.processA2O({ item: { title: 'Hello' } }),
		).rejects.toThrowError(
			'Invalid payload. Can\'t update nested record "comment.item" without'
			+ ' field "comment.collection" being set.',
		);
	});

	test('refuses a nested record of a collection not allowed', async () => {
		const service = new PayloadService('comment', { knex: db, schema });

		await expect(
			service.processA2O({ collection: 'video', item: { title: 'Hello' } }),
		).rejects.toThrowError(InvalidPayloadError);

		await expect(
			service.processA2O({ collection: 'video', item: { title: 'Hello' } }),
		).rejects.toThrowError(
			'Invalid payload. "comment.item" can\'t be linked to collection "video".',
		);
	});
});

describe('processM2O', () => {
	const schema = new SchemaBuilder()
		.collection('city', (c) => {
			c.field('id').id();
			c.field('country').m2o('country');
		})
		.build();

	test('updates a nested record whose primary key exists', async () => {
		tracker.on.select('country').response([{ id: 3 }]);
		const updateOneSpy = vi.fn().mockResolvedValue(3);

		vi.mocked(getService).mockReturnValue({
			updateOne: updateOneSpy,
		} as unknown as ItemsService);

		const service = new PayloadService('city', { knex: db, schema });

		const result = await service.processM2O({
			country: { id: 3, name: 'France' },
		});

		expect(updateOneSpy).toHaveBeenCalledWith(
			3,
			{ name: 'France' },
			expect.any(Object),
		);

		expect(result.payload).toEqual({ country: 3 });
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

		await service.processO2M({ cities: [{ id: 4, name: 'Lyon' }] }, 1);

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

		await new PayloadService('country', { knex: db, schema }).processO2M(
			{ cities: { update: [{ id: 4, name: 'Lyon' }] } },
			1,
		);

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

		await new PayloadService('country', { knex: db, schema }).processO2M(
			{ cities: { update: [{ id: 4, name: 'Lyon' }] } },
			1,
		);

		expect(updateOneSpy).toHaveBeenCalledWith(
			4,
			{ name: 'Lyon' },
			expect.any(Object),
		);
	});

	test('falls back to the payload key without a parent key', async () => {
		tracker.on.select('city').response([{ id: 4, country_id: 2 }]);
		const updateOneSpy = vi.fn().mockResolvedValue(4);

		vi.mocked(getService).mockReturnValue({
			updateOne: updateOneSpy,
		} as unknown as ItemsService);

		await new PayloadService('country', { knex: db, schema }).processO2M(
			{ id: 7, cities: { update: [{ id: 4, name: 'Lyon' }] } },
			null as unknown as PrimaryKey,
		);

		expect(updateOneSpy).toHaveBeenCalledWith(
			4,
			{ name: 'Lyon', country_id: 7 },
			expect.any(Object),
		);
	});
});
