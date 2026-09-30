import { API_EXTENSION_TYPES, HYBRID_EXTENSION_TYPES } from '@directus/constants';
import { useEnv } from '@directus/env';
import type { Extension } from '@directus/types';
import { isTypeIn } from '@directus/utils';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { flushCaches, getCache } from './cache.js';
import { holdCacheLock, releaseCacheLock } from './cache-lock.js';
import { resolveCoreBuildId } from './core-build-id.js';
import { getMilliseconds } from './utils/get-milliseconds.js';
import type { ExtensionManager } from './extensions/manager.js';
import { useLogger } from './logger/index.js';
import { scopedCachePurgeEnabled } from './scoped-cache/config.js';
import { pauseScopedCacheFills } from './scoped-cache/fill-pause.js';
import { useScopedCacheStore } from './scoped-cache/store.js';

// The response cache lives in an external redis and survives a container swap, so
// a code-only deploy — a hook/extension or a core (fork) reshaping change shipped
// with no migration and no directus/version bump — keeps serving the previous
// build's response shape until CACHE_TTL expires. flushCaches() otherwise runs
// only from the migration runner. On boot we fingerprint the running build and
// flush the caches once when that fingerprint changed, so the deploy self-heals.

const BUILD_IDENTITY_KEY = 'build-identity';
const BUILD_IDENTITY_FLUSH_LOCK = 'build-identity-flush-lock';

// Only api-side extension code can reshape a read response; an app-only extension
// (interface, display, layout, module, panel, theme) never runs server-side, so it
// can't move the cached shape. Hook and endpoint carry a single string entrypoint;
// operation (hybrid) and bundle split app/api and only the api side matters here.
function apiEntrypointFile(extension: Extension): string | null {
	if (isTypeIn(extension, API_EXTENSION_TYPES)) {
		return path.resolve(extension.path, extension.entrypoint);
	}

	if (isTypeIn(extension, HYBRID_EXTENSION_TYPES) || extension.type === 'bundle') {
		return path.resolve(extension.path, extension.entrypoint.api);
	}

	return null;
}

// Case A (extensions): a content hash of every loaded api-side extension bundle, so
// an extension logic change busts the fingerprint even when its name/version and the
// directus version all stay put.
async function hashApiExtensions(
	extensionManager: ExtensionManager,
): Promise<string> {
	const hash = createHash('sha1');

	const apiExtensions = extensionManager.extensions
		.map((extension) => ({ extension, file: apiEntrypointFile(extension) }))
		.filter((entry): entry is { extension: Extension; file: string } => {
			return entry.file !== null;
		})
		.sort((a, b) => a.extension.name.localeCompare(b.extension.name));

	for (const { extension: ext, file } of apiExtensions) {
		hash.update(`${ext.name}\0${ext.version ?? ''}\0${ext.type}\0`);

		try {
			hash.update(await readFile(file));
		}
		catch {
			// A bundle we can't read still contributes its identity above; a read
			// failure must not silently collapse two builds onto one fingerprint.
			hash.update('<unreadable>');
		}

		// Frame the content so its end can't merge with the next entry's name.
		hash.update('\0');
	}

	return hash.digest('hex');
}

export async function computeBuildIdentity(
	extensionManager: ExtensionManager,
): Promise<string> {
	const core = resolveCoreBuildId();
	const extensions = await hashApiExtensions(extensionManager);

	return createHash('sha1')
		.update(`${core}\0${extensions}`)
		.digest('hex');
}

/**
 * How long the lock naming the instance that is flushing stands on its own.
 *
 * Refreshed for as long as the flush runs, so what this bounds is a flusher
 * that died with its process rather than the work it was doing. Left to expire
 * under a flush still running, the lock is handed back while its holder is
 * mid-scan and every instance booting after that starts a flush of its own — on
 * a deploy that is the whole pool, each one walking the same keyspace while the
 * workers beside it are trying to boot.
 */
const FLUSH_LOCK_MS = 30_000;

/** Well inside the TTL, so a busy event loop cannot let the lock lapse. */
const FLUSH_LOCK_REFRESH_MS = 10_000;

/** What the race resolves with when the flush is the one still going. */
const STILL_FLUSHING = Symbol('still flushing');

/**
 * Flushes, holding the lock for as long as that takes, and records the build it
 * flushed for once it is done. The lock names the flush, so a flush that lost it
 * to its TTL never renews or releases the one another instance claimed since.
 */
async function flushHoldingTheLock(
	identity: string,
	flushToken: string,
): Promise<void> {
	const { lockCache } = getCache();
	let refreshing: Promise<unknown> = Promise.resolve();

	const refresh = setInterval(() => {
		refreshing = holdCacheLock(
			lockCache,
			BUILD_IDENTITY_FLUSH_LOCK,
			flushToken,
			FLUSH_LOCK_MS,
		).catch(() => undefined);
	}, FLUSH_LOCK_REFRESH_MS);

	// Nothing about a cache flush should hold a process that is otherwise done.
	refresh.unref();

	try {
		await flushCaches(true);
		await lockCache.set(BUILD_IDENTITY_KEY, identity);
	}
	finally {
		clearInterval(refresh);
		// A refresh still on the wire would claim the lock again after the release.
		await refreshing;

		await releaseCacheLock(lockCache, BUILD_IDENTITY_FLUSH_LOCK, flushToken)
			.catch(() => undefined);
	}
}

export async function flushCachesIfBuildChanged(
	extensionManager: ExtensionManager,
): Promise<void> {
	const env = useEnv();
	const logger = useLogger();

	if (env['CACHE_AUTO_FLUSH_ON_DEPLOY'] !== true) {
		return;
	}

	// Only a redis response cache survives a container swap; a memory store boots
	// empty, so there is nothing stale to heal and no shared store to persist the
	// fingerprint in.
	if (env['CACHE_ENABLED'] !== true || env['CACHE_STORE'] !== 'redis') {
		return;
	}

	// Best-effort: createApp() awaits this, so a redis error must never abort boot.
	try {
		const { lockCache } = getCache();
		const identity = await computeBuildIdentity(extensionManager);

		if ((await lockCache.get(BUILD_IDENTITY_KEY)) === identity) {
			return;
		}

		// Redis-gate so exactly one instance flushes when several boot together on
		// a deploy. The lock + stored fingerprint live in lockCache, which
		// flushCaches() leaves untouched. A loser returns here trusting the holder
		// to flush, so two deploys inside one flush can drop the later one —
		// bounded by CACHE_TTL, accepted.
		const flushToken = randomUUID();

		if (!(await holdCacheLock(
			lockCache,
			BUILD_IDENTITY_FLUSH_LOCK,
			flushToken,
			FLUSH_LOCK_MS,
		))) {
			return;
		}

		// Re-read under the lock: another instance may have flushed and stored the
		// new id since our check.
		if ((await lockCache.get(BUILD_IDENTITY_KEY)) === identity) {
			await releaseCacheLock(lockCache, BUILD_IDENTITY_FLUSH_LOCK, flushToken);
			return;
		}

		logger.info('[cache] Build identity changed since last boot, flushing');

		// `createApp()` awaits this before the server listens, and a flush walks
		// every key the response cache holds — 167s against a production keyspace
		// (https://github.com/jclaveau/directus/issues/468). Waited on for a
		// budget of its own and then left to finish: the boot it holds up is a
		// worker the pool is waiting for, and the flush records the build it
		// flushed for whether or not anyone was still waiting on it. Its own
		// rather than `CACHE_FLUSH_TIMEOUT`, which a deploy step sizes for the
		// whole flush it waits out — the planner gives that one 120s.
		const budget = getMilliseconds(
			env['CACHE_AUTO_FLUSH_ON_DEPLOY_TIMEOUT'],
			30_000,
		);

		let waited: ReturnType<typeof setTimeout> | undefined;

		const outcome = await Promise.race([
			flushHoldingTheLock(identity, flushToken).catch((error: unknown) => {
				logger.warn(error, '[cache] build-identity flush failed');
			}),
			new Promise<typeof STILL_FLUSHING>((resolve) => {
				waited = setTimeout(() => resolve(STILL_FLUSHING), budget);
			}),
		]);

		clearTimeout(waited);

		if (outcome === STILL_FLUSHING) {
			logger.warn(
				`[cache] still flushing after ${budget}ms, booting without waiting `
				+ 'for the rest of it',
			);
		}
	}
	catch (err) {
		logger.warn(err, '[cache] build-identity self-heal failed');
	}
}

/**
 * Stop trusting the index-key sets when this build is not the one the last boot
 * ran, whatever `CACHE_AUTO_FLUSH_ON_DEPLOY` says: a build older than them, rolled
 * back to, filed sets they do not name, and nothing else of it is left to notice.
 * And hold this process's fills while the pause that change opened runs
 * (`scopedCacheFillPaused`), which a replica booting on the recorded build joins.
 *
 * The core build alone, not the extension hash: an extension cannot change how
 * the index is filed, and reading every bundle is what a boot cannot afford twice.
 * A replica of one build reads the same identity, so only a deploy opens a pause.
 * Never throws: a boot must not fail on it. Fills stay paused when it fails, until
 * the reconnect that runs it again. `CACHE_SCOPED_DEPLOY_FILL_PAUSE_MAX` is a
 * duration of 0 or more by then: `validateDurationEnv` refused any other at boot.
 */
export async function recordScopedCacheBuild(): Promise<void> {
	// A process that does not purge by scope files no index-key set, so its build
	// has nothing to pause for.
	if (!scopedCachePurgeEnabled()) {
		return;
	}

	const logger = useLogger();

	const parsedPauseMs = getMilliseconds(
		useEnv()['CACHE_SCOPED_DEPLOY_FILL_PAUSE_MAX'],
		0,
	);

	try {
		const buildIdentity = resolveCoreBuildId();

		// `SET ... PX` refuses a fraction ("4.1m" parses to 245999.99999999997),
		// and refuses it after the script has recorded the build. Up, so a pause
		// never runs shorter than asked.
		const { buildChanged, fillPauseLeftMs } = await useScopedCacheStore()
			.recordBuildIdentity(buildIdentity, Math.ceil(parsedPauseMs));

		pauseScopedCacheFills(fillPauseLeftMs, buildIdentity);

		if (buildChanged) {
			logger.info(
				`[scoped-cache] build ${buildIdentity} differs from the last boot's: `
				+ 'index-key sets untrusted until the next reap',
			);
		}

		if (fillPauseLeftMs > 0) {
			logger.info(
				`[scoped-cache] fills paused after a deploy, for at most `
				+ `${fillPauseLeftMs} ms`,
			);
		}
	}
	catch (error) {
		logger.warn(
			error,
			`[scoped-cache] recording the build for the index failed: ${error}`,
		);
	}
}
