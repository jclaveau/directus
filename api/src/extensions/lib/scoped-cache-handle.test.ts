import { SchemaBuilder } from '@directus/schema-builder';
import { oneLine } from '@directus/utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Mutable fixture the hoisted mocks read, so each test can flip cache presence and
// scoped mode without re-mocking.
const state = vi.hoisted(() => {
	return {
		cache: { clear: vi.fn(), delete: vi.fn() } as any,
		cacheNull: false,
		scopedEnabled: true,
	};
});

const purgeScopedCache = vi.hoisted(() => vi.fn());
const scopedCacheSnapshot = vi.hoisted(() => vi.fn());

vi.mock('../../database/index.js', () => {
	return { default: () => ({}) };
});

vi.mock('../../logger/index.js', () => {
	return { useLogger: () => ({ warn: vi.fn() }) };
});

vi.mock('../../cache.js', () => {
	return {
		getCache: () => {
			return {
				cache: state.cacheNull
					? null
					: state.cache,
			};
		},
	};
});

// Keep scopedCacheCollectionPinsFromRows + composeScopedCachePaths real so pin
// derivation and relational-scope detection run; only spy the purge sink and pin
// scoped mode.
vi.mock('../../scoped-cache/index.js', async (importOriginal) => {
	const actual =
		await importOriginal<typeof import('../../scoped-cache/index.js')>();

	return {
		...actual,
		ItemScopedCacheService: class {
			snapshot = scopedCacheSnapshot;
		},
		purgeScopedCache,
		scopedCachePurgeEnabled: () => state.scopedEnabled,
	};
});

const { createScopedCacheExtensionHandle } =
	await import('./scoped-cache-handle.js');

function schemaScopedBy(fields: string[]) {
	const schema = new SchemaBuilder()
		.collection('articles', (c) => {
			c.field('id').id();
			c.field('owner').integer();
		})
		.build();

	schema.collections['articles']!.scopedCacheFields = fields;

	return async () => schema;
}

const getSchema = schemaScopedBy(['owner']);

afterEach(() => {
	vi.clearAllMocks();
	state.cacheNull = false;
	state.scopedEnabled = true;
});

describe('createScopedCacheExtensionHandle', () => {
	it('scoped on: binds the purge to each row\'s own fingerprint', async () => {
		const handle = createScopedCacheExtensionHandle(getSchema);

		// Two rows of owner 7, one of owner 9. Each keeps its key beside its owner
		// rather than flattening into one slice per value, so a read pinned to
		// `id=1 AND owner=9` — a pair no row here holds — stands.
		await handle.purgeForMutatedRows('articles', [
			{ id: 1, owner: 7 },
			{ id: 2, owner: 7 },
			{ id: 3, owner: 9 },
		]);

		expect(purgeScopedCache).toHaveBeenCalledTimes(1);

		expect(purgeScopedCache).toHaveBeenCalledWith(
			state.cache,
			'articles',
			[],
			null,
			{
				rowFingerprints: [
					{
						collection: 'articles',
						pinnedScope: { id: ['1'], owner: ['7'] },
					},
					{
						collection: 'articles',
						pinnedScope: { id: ['2'], owner: ['7'] },
					},
					{
						collection: 'articles',
						pinnedScope: { id: ['3'], owner: ['9'] },
					},
				],
				indexPath: 'owner',
			},
		);

		expect(state.cache.clear).not.toHaveBeenCalled();
	});

	it('no scopedCacheFields: pins the rows by their primary key', async () => {
		const bare = new SchemaBuilder()
			.collection('logs', (c) => {
				c.field('id').id();
			})
			.build();

		const handle = createScopedCacheExtensionHandle(async () => bare);

		await handle.purgeForMutatedRows('logs', [{ id: 1 }]);

		// A collection declaring nothing still pins its key on every single-row read,
		// so a bypassed write owes that slice — the bare pin alone would leave it
		// stale. It splits its index by nothing, so the purge reads the bare set.
		expect(purgeScopedCache).toHaveBeenCalledWith(
			state.cache,
			'logs',
			[],
			null,
			{
				rowFingerprints: [
					{ collection: 'logs', pinnedScope: { id: ['1'] } },
				],
				indexPath: null,
			},
		);
	});

	it(oneLine`
		collection absent from the schema: purges its bare pin only — it resolves no key
		and no scope field, and that pin still drops its reads
	`, async () => {
		const handle = createScopedCacheExtensionHandle(getSchema);

		await handle.purgeForMutatedRows('ghost', [{ id: 1 }]);

		expect(purgeScopedCache).toHaveBeenCalledWith(state.cache, 'ghost', []);
	});

	it('row missing a scope field: collection-wide purge, not stale', async () => {
		const handle = createScopedCacheExtensionHandle(getSchema);

		// One row resolves owner, the other omits it — 'coarse' must degrade the whole
		// purge to collection-wide (null) rather than drop only the resolvable slice.
		await handle.purgeForMutatedRows('articles', [
			{ id: 1, owner: 7 },
			{ id: 2, note: 'x' },
		]);

		expect(purgeScopedCache).toHaveBeenCalledWith(state.cache, 'articles', null);
	});

	it('row missing its primary key: collection-wide purge, not stale', async () => {
		const handle = createScopedCacheExtensionHandle(getSchema);

		// The key is a pinned field like any other, so a row handed over without it
		// leaves its own slice unresolvable → collection-wide rather than stale.
		await handle.purgeForMutatedRows('articles', [
			{ id: 1, owner: 7 },
			{ owner: 9 },
		]);

		expect(purgeScopedCache).toHaveBeenCalledWith(state.cache, 'articles', null);
	});

	it(oneLine`
		relational scope: binds the purge to the snapshot of the rows' keys
	`, async () => {
		const getRelationalSchema = schemaScopedBy(['account.owner']);
		const handle = createScopedCacheExtensionHandle(getRelationalSchema);

		scopedCacheSnapshot.mockResolvedValueOnce({
			canResolveSlicesFromRows: true,
			rows: [
				{
					key: 1,
					row: { id: 1, 'account.owner': 7 },
					fingerprint: {
						collection: 'articles',
						pinnedScope: { id: ['1'], 'account.owner': ['7'] },
					},
				},
				{
					key: 2,
					row: { id: 2, 'account.owner': 9 },
					fingerprint: {
						collection: 'articles',
						pinnedScope: { id: ['2'], 'account.owner': ['9'] },
					},
				},
			],
		});

		await handle.purgeForMutatedRows('articles', [
			{ id: 1, account: 42 },
			{ id: 2, account: 43 },
		]);

		expect(scopedCacheSnapshot).toHaveBeenCalledWith([1, 2]);

		expect(purgeScopedCache).toHaveBeenCalledWith(
			state.cache,
			'articles',
			[],
			null,
			{
				rowFingerprints: [
					{
						collection: 'articles',
						pinnedScope: { id: ['1'], 'account.owner': ['7'] },
					},
					{
						collection: 'articles',
						pinnedScope: { id: ['2'], 'account.owner': ['9'] },
					},
				],
				indexPath: null,
			},
		);
	});

	it('relational scope, snapshot unresolvable: collection-wide purge', async () => {
		const getRelationalSchema = schemaScopedBy(['account.owner']);
		const handle = createScopedCacheExtensionHandle(getRelationalSchema);

		scopedCacheSnapshot.mockResolvedValueOnce({
			canResolveSlicesFromRows: false,
			rows: [],
		});

		await handle.purgeForMutatedRows('articles', [{ id: 1, account: 42 }]);

		expect(purgeScopedCache).toHaveBeenCalledWith(state.cache, 'articles', null);
	});

	it(oneLine`
		relational scope, row missing its primary key: collection-wide purge
	`, async () => {
		const getRelationalSchema = schemaScopedBy(['account.owner']);
		const handle = createScopedCacheExtensionHandle(getRelationalSchema);

		await handle.purgeForMutatedRows('articles', [
			{ id: 1, account: 42 },
			{ account: 43 },
		]);

		expect(scopedCacheSnapshot).not.toHaveBeenCalled();
		expect(purgeScopedCache).toHaveBeenCalledWith(state.cache, 'articles', null);
	});

	it(oneLine`
		relational scope, a key the snapshot does not find: collection-wide purge
	`, async () => {
		const getRelationalSchema = schemaScopedBy(['account.owner']);
		const handle = createScopedCacheExtensionHandle(getRelationalSchema);

		// Row 2 was deleted: the read finds row 1 only, and row 2's old owner is
		// named nowhere.
		scopedCacheSnapshot.mockResolvedValueOnce({
			canResolveSlicesFromRows: true,
			rows: [
				{
					key: 1,
					row: { id: 1, 'account.owner': 7 },
					fingerprint: {
						collection: 'articles',
						pinnedScope: { id: ['1'], 'account.owner': ['7'] },
					},
				},
			],
		});

		await handle.purgeForMutatedRows('articles', [
			{ id: 1, account: 42 },
			{ id: 2, account: 43 },
			{ id: 2, account: 43 },
		]);

		expect(scopedCacheSnapshot).toHaveBeenCalledWith([1, 2]);
		expect(purgeScopedCache).toHaveBeenCalledWith(state.cache, 'articles', null);
	});

	it('relational scope, snapshot throws: collection-wide purge', async () => {
		const getRelationalSchema = schemaScopedBy(['account.owner']);
		const handle = createScopedCacheExtensionHandle(getRelationalSchema);

		scopedCacheSnapshot.mockRejectedValueOnce(new Error('pool exhausted'));

		await handle.purgeForMutatedRows('articles', [{ id: 1, account: 42 }]);

		expect(purgeScopedCache).toHaveBeenCalledWith(state.cache, 'articles', null);
	});

	it('scoped off: full cache.clear(), no scoped purge', async () => {
		state.scopedEnabled = false;

		const handle = createScopedCacheExtensionHandle(getSchema);

		await handle.purgeForMutatedRows('articles', [{ owner: 7 }]);

		expect(state.cache.clear).toHaveBeenCalledTimes(1);
		expect(purgeScopedCache).not.toHaveBeenCalled();
	});

	it('cache disabled (null): no-op', async () => {
		state.cacheNull = true;

		const handle = createScopedCacheExtensionHandle(getSchema);

		await handle.purgeForMutatedRows('articles', [{ owner: 7 }]);

		expect(purgeScopedCache).not.toHaveBeenCalled();
		expect(state.cache.clear).not.toHaveBeenCalled();
	});
});
