import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	computeBuildIdentity,
	flushCachesIfBuildChanged,
} from './cache-build-identity.js';
import { flushCaches, getCache } from './cache.js';

const env = vi.hoisted(() => ({}) as Record<string, any>);
const version = vi.hoisted(() => ({ value: '1.0.0' }));

vi.mock('@directus/env', () => ({ useEnv: () => env }));

vi.mock('directus/version', () => {
	return {
		get version() {
			return version.value;
		},
	};
});

vi.mock('./logger/index.js', () => ({ useLogger: () => ({ info: vi.fn() }) }));
vi.mock('./cache.js', () => ({ flushCaches: vi.fn(), getCache: vi.fn() }));

// path.resolve(ext.path, entrypoint) → content; readFile returns those bytes so a
// content edit moves the fingerprint. An unmapped path rejects, and the extension
// still contributes its name/version/type.
const files = vi.hoisted(() => new Map<string, string>());

vi.mock('node:fs/promises', () => {
	return {
		readFile: vi.fn((file: string) => {
			if (files.has(file)) {
				return Promise.resolve(Buffer.from(files.get(file)!));
			}

			return Promise.reject(new Error('ENOENT'));
		}),
	};
});

function makeLockCache() {
	const store = new Map<string, unknown>();

	return {
		store,
		get: vi.fn((key: string) => Promise.resolve(store.get(key))),
		set: vi.fn((key: string, value: unknown) => {
			store.set(key, value);
			return Promise.resolve(true);
		}),
		delete: vi.fn((key: string) => {
			store.delete(key);
			return Promise.resolve(true);
		}),
	};
}

function hook(name: string, path: string, entrypoint = 'index.js') {
	return { type: 'hook', name, path, entrypoint, local: true } as any;
}

function moduleExt(name: string, path: string, entrypoint = 'index.js') {
	return { type: 'module', name, path, entrypoint, local: true } as any;
}

function operation(name: string, path: string) {
	const entrypoint = { app: 'app.js', api: 'api.js' };
	return { type: 'operation', name, path, entrypoint, local: true } as any;
}

function managerOf(extensions: any[]) {
	return { extensions } as any;
}

beforeEach(() => {
	for (const key of Object.keys(env)) {
		delete env[key];
	}

	env['CACHE_AUTO_FLUSH_ON_DEPLOY'] = true;
	env['CACHE_ENABLED'] = true;
	env['CACHE_STORE'] = 'redis';
	version.value = '1.0.0';
	files.clear();
	delete process.env['CACHE_BUILD_ID'];
	delete process.env['RAILWAY_GIT_COMMIT_SHA'];
});

afterEach(() => {
	vi.clearAllMocks();
	vi.unstubAllGlobals();
});

describe('computeBuildIdentity', () => {
	it('is stable and order-independent for one core id + content', async () => {
		files.set('/ext/a/index.js', 'hook-a-v1');
		files.set('/ext/b/index.js', 'hook-b-v1');

		const a = hook('a', '/ext/a');
		const b = hook('b', '/ext/b');
		const forward = await computeBuildIdentity(managerOf([a, b]));
		const reversed = await computeBuildIdentity(managerOf([b, a]));

		expect(forward).toBe(reversed);
	});

	it('changes when an api extension bundle content changes', async () => {
		files.set('/ext/a/index.js', 'hook-a-v1');
		const before = await computeBuildIdentity(managerOf([hook('a', '/ext/a')]));

		files.set('/ext/a/index.js', 'hook-a-v2');
		const after = await computeBuildIdentity(managerOf([hook('a', '/ext/a')]));

		expect(after).not.toBe(before);
	});

	it('hashes the api side of operation (hybrid) extensions', async () => {
		files.set('/ext/op/api.js', 'op-v1');
		files.set('/ext/op/app.js', 'app-only-changes-here');
		const manager = managerOf([operation('op', '/ext/op')]);
		const before = await computeBuildIdentity(manager);

		files.set('/ext/op/api.js', 'op-v2');
		const after = await computeBuildIdentity(manager);

		expect(after).not.toBe(before);
	});

	it('ignores app-only extensions (never reshape a read response)', async () => {
		files.set('/ext/m/index.js', 'module-v1');
		const before = await computeBuildIdentity(managerOf([moduleExt('m', '/ext/m')]));

		files.set('/ext/m/index.js', 'module-v2');
		const after = await computeBuildIdentity(managerOf([moduleExt('m', '/ext/m')]));

		expect(after).toBe(before);
	});

	it('core id precedence: override > baked > railway > version', async () => {
		const fromVersion = await computeBuildIdentity(managerOf([]));

		version.value = '2.0.0';
		const fromNewVersion = await computeBuildIdentity(managerOf([]));
		expect(fromNewVersion).not.toBe(fromVersion);

		process.env['RAILWAY_GIT_COMMIT_SHA'] = 'deadbeef';
		const fromGitSha = await computeBuildIdentity(managerOf([]));
		expect(fromGitSha).not.toBe(fromNewVersion);

		// Baked commit (tsdown define) outranks the platform env.
		vi.stubGlobal('__DIRECTUS_BUILD_COMMIT__', 'baked-sha');
		const fromBaked = await computeBuildIdentity(managerOf([]));
		expect(fromBaked).not.toBe(fromGitSha);

		env['CACHE_BUILD_ID'] = 'explicit-id';
		const fromExplicit = await computeBuildIdentity(managerOf([]));
		expect(fromExplicit).not.toBe(fromBaked);
	});
});

describe('flushCachesIfBuildChanged', () => {
	it('flushes and persists the identity on first boot', async () => {
		const lockCache = makeLockCache();
		vi.mocked(getCache).mockReturnValue({ lockCache } as any);
		files.set('/ext/a/index.js', 'hook-a-v1');

		const manager = managerOf([hook('a', '/ext/a')]);
		await flushCachesIfBuildChanged(manager);

		const identity = await computeBuildIdentity(manager);
		expect(flushCaches).toHaveBeenCalledWith(true);
		expect(lockCache.store.get('build-identity')).toBe(identity);
		expect(lockCache.store.has('build-identity-flush-lock')).toBe(false);
	});

	it('does nothing when the stored identity matches the build', async () => {
		const lockCache = makeLockCache();
		vi.mocked(getCache).mockReturnValue({ lockCache } as any);
		files.set('/ext/a/index.js', 'hook-a-v1');

		const manager = managerOf([hook('a', '/ext/a')]);
		lockCache.store.set('build-identity', await computeBuildIdentity(manager));

		await flushCachesIfBuildChanged(manager);

		expect(flushCaches).not.toHaveBeenCalled();
	});

	it('does not flush while another instance holds the lock', async () => {
		const lockCache = makeLockCache();
		vi.mocked(getCache).mockReturnValue({ lockCache } as any);
		lockCache.store.set('build-identity', 'stale');
		lockCache.store.set('build-identity-flush-lock', true);

		await flushCachesIfBuildChanged(managerOf([]));

		expect(flushCaches).not.toHaveBeenCalled();
	});

	it.each([
		['disabled switch', { CACHE_AUTO_FLUSH_ON_DEPLOY: false }],
		['non-redis store', { CACHE_STORE: 'memory' }],
		['cache disabled', { CACHE_ENABLED: false }],
	])('skips entirely (%s): no getCache, no flush', async (_label, overrides) => {
		Object.assign(env, overrides);

		await flushCachesIfBuildChanged(managerOf([hook('a', '/ext/a')]));

		expect(getCache).not.toHaveBeenCalled();
		expect(flushCaches).not.toHaveBeenCalled();
	});
});
