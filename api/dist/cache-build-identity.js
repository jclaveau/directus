import { getMilliseconds } from "./utils/get-milliseconds.js";
import { useLogger } from "./logger/index.js";
import { responseCacheWanted } from "./cache-settings.js";
import { useScopedCacheStore } from "./scoped-cache/store.js";
import { scopedCachePurgeEnabled } from "./scoped-cache/config.js";
import { holdCacheLock, releaseCacheLock } from "./cache-lock.js";
import { pauseScopedCacheFills } from "./scoped-cache/fill-pause.js";
import { flushCaches, getCache } from "./cache.js";
import { resolveCoreBuildId } from "./core-build-id.js";
import { useEnv } from "@directus/env";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isTypeIn } from "@directus/utils";
import { createHash, randomUUID } from "node:crypto";
import { API_EXTENSION_TYPES, HYBRID_EXTENSION_TYPES } from "@directus/constants";

//#region src/cache-build-identity.ts
const BUILD_IDENTITY_KEY = "build-identity";
const BUILD_IDENTITY_FLUSH_LOCK = "build-identity-flush-lock";
function apiEntrypointFile(extension) {
	if (isTypeIn(extension, API_EXTENSION_TYPES)) return path.resolve(extension.path, extension.entrypoint);
	if (isTypeIn(extension, HYBRID_EXTENSION_TYPES) || extension.type === "bundle") return path.resolve(extension.path, extension.entrypoint.api);
	return null;
}
async function hashApiExtensions(extensionManager) {
	const hash = createHash("sha1");
	const apiExtensions = extensionManager.extensions.map((extension) => ({
		extension,
		file: apiEntrypointFile(extension)
	})).filter((entry) => {
		return entry.file !== null;
	}).sort((a, b) => a.extension.name.localeCompare(b.extension.name));
	for (const { extension: ext, file } of apiExtensions) {
		hash.update(`${ext.name}\0${ext.version ?? ""}\0${ext.type}\0`);
		try {
			hash.update(await readFile(file));
		} catch {
			hash.update("<unreadable>");
		}
		hash.update("\0");
	}
	return hash.digest("hex");
}
async function computeBuildIdentity(extensionManager) {
	const core = resolveCoreBuildId();
	const extensions = await hashApiExtensions(extensionManager);
	return createHash("sha1").update(`${core}\0${extensions}`).digest("hex");
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
const FLUSH_LOCK_MS = 3e4;
/** Well inside the TTL, so a busy event loop cannot let the lock lapse. */
const FLUSH_LOCK_REFRESH_MS = 1e4;
/** What the race resolves with when the flush is the one still going. */
const STILL_FLUSHING = Symbol("still flushing");
/**
* Flushes, holding the lock for as long as that takes, and records the build it
* flushed for once it is done. The lock names the flush, so a flush that lost it
* to its TTL never renews or releases the one another instance claimed since.
*/
async function flushHoldingTheLock(identity, flushToken) {
	const { lockCache } = getCache();
	let lockRefreshing = Promise.resolve();
	const refresh = setInterval(() => {
		lockRefreshing = holdCacheLock(lockCache, BUILD_IDENTITY_FLUSH_LOCK, flushToken, FLUSH_LOCK_MS).catch(() => void 0);
	}, FLUSH_LOCK_REFRESH_MS);
	refresh.unref();
	try {
		await flushCaches(true);
		await lockCache.set(BUILD_IDENTITY_KEY, identity);
	} finally {
		clearInterval(refresh);
		await lockRefreshing;
		await releaseCacheLock(lockCache, BUILD_IDENTITY_FLUSH_LOCK, flushToken).catch(() => void 0);
	}
}
async function flushCachesIfBuildChanged(extensionManager) {
	const env = useEnv();
	const logger = useLogger();
	if (env["CACHE_AUTO_FLUSH_ON_DEPLOY"] !== true) return;
	if (responseCacheWanted() === false || env["CACHE_STORE"] !== "redis") return;
	try {
		const { lockCache } = getCache();
		const identity = await computeBuildIdentity(extensionManager);
		if (await lockCache.get(BUILD_IDENTITY_KEY) === identity) return;
		const flushToken = randomUUID();
		if (!await holdCacheLock(lockCache, BUILD_IDENTITY_FLUSH_LOCK, flushToken, FLUSH_LOCK_MS)) return;
		if (await lockCache.get(BUILD_IDENTITY_KEY) === identity) {
			await releaseCacheLock(lockCache, BUILD_IDENTITY_FLUSH_LOCK, flushToken);
			return;
		}
		logger.info("[cache] Build identity changed since last boot, flushing");
		const budget = getMilliseconds(env["CACHE_AUTO_FLUSH_ON_DEPLOY_TIMEOUT"], 3e4);
		let waited;
		const outcome = await Promise.race([flushHoldingTheLock(identity, flushToken).catch((error) => {
			logger.warn(error, "[cache] build-identity flush failed");
		}), new Promise((resolve$1) => {
			waited = setTimeout(() => resolve$1(STILL_FLUSHING), budget);
		})]);
		clearTimeout(waited);
		if (outcome === STILL_FLUSHING) logger.warn(`[cache] still flushing after ${budget}ms, booting without waiting for the rest of it`);
	} catch (err) {
		logger.warn(err, "[cache] build-identity self-heal failed");
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
async function recordScopedCacheBuild() {
	if (!scopedCachePurgeEnabled()) return;
	const logger = useLogger();
	const parsedPauseMs = getMilliseconds(useEnv()["CACHE_SCOPED_DEPLOY_FILL_PAUSE_MAX"], 0);
	try {
		const buildIdentity = resolveCoreBuildId();
		const { buildChanged, fillPauseLeftMs } = await useScopedCacheStore().recordBuildIdentity(buildIdentity, Math.ceil(parsedPauseMs));
		pauseScopedCacheFills(fillPauseLeftMs, buildIdentity);
		if (buildChanged) logger.info(`[scoped-cache] build ${buildIdentity} differs from the last boot's: index-key sets untrusted until the next reap`);
		if (fillPauseLeftMs > 0) logger.info(`[scoped-cache] fills paused after a deploy, for at most ${fillPauseLeftMs} ms`);
	} catch (error) {
		logger.warn(error, `[scoped-cache] recording the build for the index failed: ${error}`);
	}
}

//#endregion
export { computeBuildIdentity, flushCachesIfBuildChanged, recordScopedCacheBuild };