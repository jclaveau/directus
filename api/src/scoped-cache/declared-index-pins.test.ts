import type { Knex } from 'knex';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLogger } from '../logger/index.js';
import { scopedCacheDeclaredIndexPins } from './declared-index-pins.js';
import { ItemScopedCacheService } from './item-scoped-cache-service.js';

vi.mock('../logger/index.js', () => ({ useLogger: vi.fn() }));

vi.mock('./item-scoped-cache-service.js', () => {
	return { ItemScopedCacheService: vi.fn() };
});

const knex = {} as Knex;
const snapshot = vi.fn();
const warn = vi.fn();

const schema = {
	collections: {
		segment_course: {
			primary: 'id',
			scopedCacheFields: ['student_course_id'],
		},
		student_courses: { primary: 'id', scopedCacheFields: ['owner'] },
	},
	relations: [{
		collection: 'segment_course',
		field: 'student_course_id',
		related_collection: 'student_courses',
	}],
} as any;

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(useLogger).mockReturnValue({ warn } as any);

	vi.mocked(ItemScopedCacheService).mockImplementation(function () {
		return { snapshot } as any;
	});

	snapshot.mockResolvedValue({
		canResolveSlicesFromRows: true,
		rows: [
			{
				key: 7,
				row: {},
				fingerprint: {
					collection: 'student_courses',
					pinnedScope: { id: ['7'], owner: ['alice'] },
				},
			},
			{
				key: 8,
				row: {},
				fingerprint: {
					collection: 'student_courses',
					pinnedScope: { id: ['8'], owner: ['\x00null'] },
				},
			},
		],
	});
});

describe('scopedCacheDeclaredIndexPins', () => {
	it('pins a first-hop pin to the values its key reads back', async () => {
		expect(await scopedCacheDeclaredIndexPins(
			schema,
			knex,
			'segment_course',
			[{
				collection: 'segment_course',
				pinnedScope: { student_course_id: ['7', '8'] },
			}],
			'student_course_id.owner',
		)).toEqual([{
			collection: 'segment_course',
			pinnedScope: {
				'student_course_id': ['7', '8'],
				'student_course_id.owner': ['alice', '\x00null'],
			},
		}]);

		expect(ItemScopedCacheService).toHaveBeenCalledWith(
			'student_courses',
			schema,
			knex,
			null,
			null,
		);

		expect(snapshot).toHaveBeenCalledWith(['7', '8']);
	});

	it('leaves out a bare pin, keeps one on the index path', async () => {
		expect(await scopedCacheDeclaredIndexPins(
			schema,
			knex,
			'segment_course',
			[
				{ collection: 'segment_course' },
				{
					collection: 'segment_course',
					pinnedScope: { 'student_course_id.owner': ['bob'] },
				},
				{
					collection: 'segment_course',
					pinnedScope: { student_course_id: ['7'] },
				},
			],
			'student_course_id.owner',
		)).toEqual([
			{
				collection: 'segment_course',
				pinnedScope: { 'student_course_id.owner': ['bob'] },
			},
			{
				collection: 'segment_course',
				pinnedScope: {
					'student_course_id': ['7'],
					'student_course_id.owner': ['alice'],
				},
			},
		]);

		expect(snapshot).toHaveBeenCalledWith(['7']);
	});

	it('reads nothing back for a pin off the first hop', async () => {
		expect(await scopedCacheDeclaredIndexPins(
			schema,
			knex,
			'segment_course',
			[
				{
					collection: 'segment_course',
					pinnedScope: { student_course_id: ['7'] },
				},
				{ collection: 'segment_course', pinnedScope: { status: ['open'] } },
			],
			'student_course_id.owner',
		)).toBeNull();

		expect(snapshot).not.toHaveBeenCalled();
	});

	it('reads nothing back when every pin is bare or on the index path', async () => {
		expect(await scopedCacheDeclaredIndexPins(
			schema,
			knex,
			'segment_course',
			[
				{ collection: 'segment_course' },
				{
					collection: 'segment_course',
					pinnedScope: { 'student_course_id.owner': ['bob'] },
				},
			],
			'student_course_id.owner',
		)).toBeNull();

		expect(snapshot).not.toHaveBeenCalled();
	});

	it('reads nothing back for an index path of one field', async () => {
		expect(await scopedCacheDeclaredIndexPins(
			schema,
			knex,
			'segment_course',
			[{
				collection: 'segment_course',
				pinnedScope: { student_course_id: ['7'] },
			}],
			'student_course_id',
		)).toBeNull();

		expect(snapshot).not.toHaveBeenCalled();
	});

	it('reads nothing back without an index path', async () => {
		expect(await scopedCacheDeclaredIndexPins(
			schema,
			knex,
			'segment_course',
			[{
				collection: 'segment_course',
				pinnedScope: { student_course_id: ['7'] },
			}],
			null,
		)).toBeNull();
	});

	it('reads nothing back when the first hop names no relation', async () => {
		expect(await scopedCacheDeclaredIndexPins(
			{ ...schema, relations: [] },
			knex,
			'segment_course',
			[{
				collection: 'segment_course',
				pinnedScope: { student_course_id: ['7'] },
			}],
			'student_course_id.owner',
		)).toBeNull();

		expect(snapshot).not.toHaveBeenCalled();
	});

	it('reads nothing back for a pin to null, which no key spells', async () => {
		expect(await scopedCacheDeclaredIndexPins(
			schema,
			knex,
			'segment_course',
			[{
				collection: 'segment_course',
				pinnedScope: { student_course_id: ['7', '\x00null'] },
			}],
			'student_course_id.owner',
		)).toBeNull();

		expect(snapshot).not.toHaveBeenCalled();
	});

	it('reads nothing back past 500 keys', async () => {
		expect(await scopedCacheDeclaredIndexPins(
			schema,
			knex,
			'segment_course',
			[{
				collection: 'segment_course',
				pinnedScope: {
					student_course_id: Array.from({ length: 501 }, (_, at) => `${at}`),
				},
			}],
			'student_course_id.owner',
		)).toBeNull();

		expect(snapshot).not.toHaveBeenCalled();
	});

	it('reads 500 keys back', async () => {
		await scopedCacheDeclaredIndexPins(
			schema,
			knex,
			'segment_course',
			[{
				collection: 'segment_course',
				pinnedScope: {
					student_course_id: Array.from({ length: 500 }, (_, at) => `${at}`),
				},
			}],
			'student_course_id.owner',
		);

		expect(snapshot).toHaveBeenCalledOnce();
	});

	it('gives up when a key reads back as no row', async () => {
		expect(await scopedCacheDeclaredIndexPins(
			schema,
			knex,
			'segment_course',
			[{
				collection: 'segment_course',
				pinnedScope: { student_course_id: ['7', '9'] },
			}],
			'student_course_id.owner',
		)).toBeNull();
	});

	it('gives up when a row reads back without the index path', async () => {
		snapshot.mockResolvedValue({
			canResolveSlicesFromRows: true,
			rows: [{
				key: 7,
				row: null,
				fingerprint: { collection: 'student_courses', pinnedScope: { id: ['7'] } },
			}],
		});

		expect(await scopedCacheDeclaredIndexPins(
			schema,
			knex,
			'segment_course',
			[{
				collection: 'segment_course',
				pinnedScope: { student_course_id: ['7'] },
			}],
			'student_course_id.owner',
		)).toBeNull();
	});

	it('gives up when the rows read back cannot resolve their slices', async () => {
		snapshot.mockResolvedValue({
			canResolveSlicesFromRows: false,
			rows: [{
				key: 7,
				row: {},
				fingerprint: {
					collection: 'student_courses',
					pinnedScope: { id: ['7'], owner: ['alice'] },
				},
			}],
		});

		expect(await scopedCacheDeclaredIndexPins(
			schema,
			knex,
			'segment_course',
			[{
				collection: 'segment_course',
				pinnedScope: { student_course_id: ['7'] },
			}],
			'student_course_id.owner',
		)).toBeNull();
	});

	it('gives up and warns when the read back fails', async () => {
		const failure = new Error('connection lost');

		snapshot.mockRejectedValue(failure);

		expect(await scopedCacheDeclaredIndexPins(
			schema,
			knex,
			'segment_course',
			[{
				collection: 'segment_course',
				pinnedScope: { student_course_id: ['7'] },
			}],
			'student_course_id.owner',
		)).toBeNull();

		expect(warn).toHaveBeenCalledWith(
			failure,
			'[scoped-cache] a declared pin on segment_course.student_course_id '
			+ 'could not be read back, reading its index whole: Error: connection lost',
		);
	});
});
