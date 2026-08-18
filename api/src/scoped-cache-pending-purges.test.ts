import { oneLine } from '@directus/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./database/index.js', () => ({ default: vi.fn() }));
vi.mock('./logger/index.js', () => ({ useLogger: vi.fn() }));

import getDatabase from './database/index.js';
import { useLogger } from './logger/index.js';
import {
	clearPendingScopedCachePurges,
	countFailedScopedCachePurgeRetry,
	listPendingScopedCachePurges,
	recordPendingScopedCachePurge,
} from './scoped-cache-pending-purges.js';

const TABLE = 'directus_scoped_cache_pending_purges';

const warn = vi.fn();

// Rows the next `select` resolves, and what each terminal was called with. A fresh
// builder per `db(table)` call on purpose: sharing one across calls makes an await
// read whichever table was named last, which is a lie about knex rather than a
// property of the code under test.
let selectRows: any[];
let calls: { table: string; op: string; payload: any }[];
let insertFails: Error | null;

beforeEach(() => {
	selectRows = [];
	calls = [];
	insertFails = null;
	vi.mocked(useLogger).mockReturnValue({ warn } as any);

	vi.mocked(getDatabase).mockImplementation((() => {
		return (table: string) => {
			const builder: any = {
				select: () => builder,
				orderBy: () => builder,
				whereIn: (_column: string, ids: number[]) => {
					builder.ids = ids;
					return builder;
				},
				update: (patch: object) => {
					builder.patch = patch;
					return builder;
				},
				insert: (rows: any) => {
					calls.push({ table, op: 'insert', payload: rows });

					return insertFails === null
						? Promise.resolve()
						: Promise.reject(insertFails);
				},
				delete: () => {
					calls.push({ table, op: 'delete', payload: builder.ids });
					return Promise.resolve();
				},
				increment: (column: string, amount: number) => {
					calls.push({
						table,
						op: 'increment',
						payload: { ids: builder.ids, patch: builder.patch, column, amount },
					});

					return Promise.resolve();
				},
				then: (resolve: (rows: any[]) => void) => {
					return Promise.resolve(selectRows).then(resolve);
				},
			};

			return builder;
		};
	}) as any);
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('recordPendingScopedCachePurge', () => {
	it('writes one row per failed tag, each aimed at its display label', async () => {
		await recordPendingScopedCachePurge(
			{
				mode: 'slices',
				collection: 'articles',
				scopedCacheTags: ['articles:id=1', 'articles:author=7'],
			},
			new Error('Connection is closed.'),
		);

		expect(calls).toHaveLength(1);
		expect(calls[0]!.table).toBe(TABLE);

		expect(calls[0]!.payload).toEqual([
			{
				failed_at: expect.any(Date),
				mode: 'slices',
				collection: 'articles',
				scoped_cache_tag: 'articles:id=1',
				attempts: 0,
				last_error: 'Connection is closed.',
			},
			{
				failed_at: expect.any(Date),
				mode: 'slices',
				collection: 'articles',
				scoped_cache_tag: 'articles:author=7',
				attempts: 0,
				last_error: 'Connection is closed.',
			},
		]);
	});

	it(oneLine`
		a coarse purge names no tag, so it is one row carrying only its reach
	`, async () => {
		await recordPendingScopedCachePurge(
			{ mode: 'collection', collection: 'articles', scopedCacheTags: [] },
			new Error('Connection is closed.'),
		);

		expect(calls[0]!.payload).toEqual([{
			failed_at: expect.any(Date),
			mode: 'collection',
			collection: 'articles',
			scoped_cache_tag: null,
			attempts: 0,
			last_error: 'Connection is closed.',
		}]);
	});

	it('carries no collection for a namespace purge', async () => {
		await recordPendingScopedCachePurge(
			{ mode: 'namespace', collection: null, scopedCacheTags: [] },
			new Error('Connection is closed.'),
		);

		expect(calls[0]!.payload).toEqual([{
			failed_at: expect.any(Date),
			mode: 'namespace',
			collection: null,
			scoped_cache_tag: null,
			attempts: 0,
			last_error: 'Connection is closed.',
		}]);
	});

	it(oneLine`
		a failing insert is logged and swallowed — the mutation already committed, so
		throwing here would answer 500 for a write that succeeded
	`, async () => {
		insertFails = new Error('deadlock detected');

		await expect(recordPendingScopedCachePurge(
			{ mode: 'slices', collection: 'articles', scopedCacheTags: ['articles:id=1'] },
			new Error('Connection is closed.'),
		)).resolves.toBeUndefined();

		expect(warn).toHaveBeenCalledOnce();
	});

	it('truncates the recorded error to 500 characters', async () => {
		await recordPendingScopedCachePurge(
			{ mode: 'slices', collection: 'articles', scopedCacheTags: ['articles:id=1'] },
			new Error('x'.repeat(900)),
		);

		expect(calls[0]!.payload[0].last_error).toBe('x'.repeat(500));
	});

	it('records a thrown non-Error by its string form', async () => {
		await recordPendingScopedCachePurge(
			{ mode: 'slices', collection: 'articles', scopedCacheTags: ['articles:id=1'] },
			'ECONNREFUSED',
		);

		expect(calls[0]!.payload[0].last_error).toBe('ECONNREFUSED');
	});
});

describe('listPendingScopedCachePurges', () => {
	it(oneLine`
		collapses repeats of one target to a single retry carrying every row it stands
		for, and keeps distinct targets apart
	`, async () => {
		// An outage records the same slice once per write that touched it, so the
		// duplicates here are the normal shape rather than an edge case.
		selectRows = [
			{
				id: 1,
				mode: 'slices',
				collection: 'articles',
				scoped_cache_tag: 'articles:id=1',
			},
			{
				id: 2,
				mode: 'slices',
				collection: 'articles',
				scoped_cache_tag: 'articles:id=2',
			},
			{
				id: 3,
				mode: 'slices',
				collection: 'articles',
				scoped_cache_tag: 'articles:id=1',
			},
			{
				id: 4,
				mode: 'collection',
				collection: 'articles',
				scoped_cache_tag: null,
			},
		];

		expect(await listPendingScopedCachePurges()).toEqual([
			{
				mode: 'slices',
				collection: 'articles',
				scopedCacheTags: ['articles:id=1'],
				ids: [1, 3],
			},
			{
				mode: 'slices',
				collection: 'articles',
				scopedCacheTags: ['articles:id=2'],
				ids: [2],
			},
			{
				mode: 'collection',
				collection: 'articles',
				scopedCacheTags: [],
				ids: [4],
			},
		]);
	});

	it(oneLine`
		separates one tag spelling recorded under two modes — the mode decides what the
		retry runs, so collapsing them would drop a purge
	`, async () => {
		selectRows = [
			{ id: 1, mode: 'slices', collection: 'articles', scoped_cache_tag: null },
			{ id: 2, mode: 'collection', collection: 'articles', scoped_cache_tag: null },
			{ id: 3, mode: 'namespace', collection: null, scoped_cache_tag: null },
		];

		expect((await listPendingScopedCachePurges()).map((row) => row.mode))
			.toEqual(['slices', 'collection', 'namespace']);
	});

	it('reads nothing back when nothing failed', async () => {
		expect(await listPendingScopedCachePurges()).toEqual([]);
	});
});

describe('clearPendingScopedCachePurges', () => {
	it('deletes exactly the rows the retry finished', async () => {
		await clearPendingScopedCachePurges([4, 9]);

		expect(calls).toEqual([{ table: TABLE, op: 'delete', payload: [4, 9] }]);
	});

	it(oneLine`
		touches the database at all only when there is something to drop
	`, async () => {
		await clearPendingScopedCachePurges([]);

		expect(getDatabase).not.toHaveBeenCalled();
	});
});

describe('countFailedScopedCachePurgeRetry', () => {
	it(oneLine`
		counts the attempt against the rows it could not finish and keeps them — a purge
		is idempotent, so giving up would leave the entry stale with nothing coming
	`, async () => {
		await countFailedScopedCachePurgeRetry(
			[4, 9],
			new Error('Connection is closed.'),
		);

		expect(calls).toEqual([{
			table: TABLE,
			op: 'increment',
			payload: {
				ids: [4, 9],
				patch: { last_error: 'Connection is closed.' },
				column: 'attempts',
				amount: 1,
			},
		}]);
	});

	it(oneLine`
		touches the database at all only when there is something to count
	`, async () => {
		await countFailedScopedCachePurgeRetry(
			[],
			new Error('Connection is closed.'),
		);

		expect(getDatabase).not.toHaveBeenCalled();
	});
});
