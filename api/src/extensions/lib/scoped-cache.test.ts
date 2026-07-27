import { SchemaBuilder } from '@directus/schema-builder';
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

// Keep scopedCacheTagsFromRows real so tag derivation from rows is exercised; only
// spy the purge sink and pin scoped mode.
vi.mock('../../scoped-cache.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../scoped-cache.js')>();

	return {
		...actual,
		purgeScopedCache,
		scopedCachePurgeEnabled: () => state.scopedEnabled,
	};
});

const { createScopedCacheExtensionHandle } = await import('./scoped-cache.js');

const schema = new SchemaBuilder()
	.collection('articles', (c) => {
		c.field('id').id();
		c.field('owner').integer();
	})
	.build();

schema.collections['articles']!.scopedCacheFields = ['owner'];

const getSchema = async () => schema;

afterEach(() => {
	vi.clearAllMocks();
	state.cacheNull = false;
	state.scopedEnabled = true;
});

describe('createScopedCacheExtensionHandle', () => {
	it('scoped on: purges bare tag + the slices the rows touched', async () => {
		const handle = createScopedCacheExtensionHandle(getSchema);

		// owner 7 appears twice — must collapse to one slice; 9 is a decoy second slice.
		await handle.purgeForMutatedRows('articles', [
			{ owner: 7 },
			{ owner: 7 },
			{ owner: 9 },
		]);

		expect(purgeScopedCache).toHaveBeenCalledTimes(1);

		expect(purgeScopedCache).toHaveBeenCalledWith(state.cache, 'articles', [
			{ collection: 'articles', field: 'owner', value: 7, type: 'integer' },
			{ collection: 'articles', field: 'owner', value: 9, type: 'integer' },
		]);

		expect(state.cache.clear).not.toHaveBeenCalled();
	});

	it('no scopedCacheFields: bare-tag purge only', async () => {
		const bare = new SchemaBuilder()
			.collection('logs', (c) => {
				c.field('id').id();
			})
			.build();

		const handle = createScopedCacheExtensionHandle(async () => bare);

		await handle.purgeForMutatedRows('logs', [{ id: 1 }]);

		expect(purgeScopedCache).toHaveBeenCalledWith(state.cache, 'logs', []);
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
