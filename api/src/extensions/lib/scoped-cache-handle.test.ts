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

// Keep scopedCacheCollectionPinsFromRows + composeScopedCachePaths real so tag
// derivation and relational-scope detection run; only spy the purge sink and pin
// scoped mode.
vi.mock('../../scoped-cache/index.js', async (importOriginal) => {
	const actual =
		await importOriginal<typeof import('../../scoped-cache/index.js')>();

	return {
		...actual,
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
		// so a bypassed write owes that slice — the bare tag alone would leave it
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
		collection absent from the schema: purges its bare tag only — it resolves no key
		and no scope field, and that tag still drops its reads
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

	it('relational (dotted) scope field: collection-wide purge', async () => {
		const getRelationalSchema = schemaScopedBy(['account.owner']);
		const handle = createScopedCacheExtensionHandle(getRelationalSchema);

		await handle.purgeForMutatedRows('articles', [{ account: 42 }]);

		// A raw row carries only the first-hop fk (account=42), not the pinned terminal,
		// so it must fall back to collection-wide rather than emit a wrong fk tag.
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
