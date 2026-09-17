import { getMilliseconds } from "./utils/get-milliseconds.js";
import { useLogger } from "./logger/index.js";
import { flushCaches, getCache } from "./cache.js";
import { useEnv } from "@directus/env";
import { readFile } from "node:fs/promises";
import { isTypeIn } from "@directus/utils";
import { createHash } from "node:crypto";
import path from "node:path";
import { API_EXTENSION_TYPES, HYBRID_EXTENSION_TYPES } from "@directus/constants";
import { version } from "directus/version";

//#region src/cache-build-identity.ts
const BUILD_IDENTITY_KEY = "build-identity";
const BUILD_IDENTITY_FLUSH_LOCK = "build-identity-flush-lock";
function resolveCoreBuildId() {
	const explicit = useEnv()["CACHE_BUILD_ID"];
	if (typeof explicit === "string" && explicit.length > 0) return explicit;
	return "811ba5ae6a2e1091eecb1c7502425abffc29d468";
}
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
* flushed for once it is done.
*/
async function flushHoldingTheLock(identity) {
	const { lockCache } = getCache();
	const refresh = setInterval(() => {
		lockCache.set(BUILD_IDENTITY_FLUSH_LOCK, true, FLUSH_LOCK_MS).catch(() => void 0);
	}, FLUSH_LOCK_REFRESH_MS);
	refresh.unref();
	try {
		await flushCaches(true);
		await lockCache.set(BUILD_IDENTITY_KEY, identity);
	} finally {
		clearInterval(refresh);
		await lockCache.delete(BUILD_IDENTITY_FLUSH_LOCK).catch(() => void 0);
	}
}
async function flushCachesIfBuildChanged(extensionManager) {
	const env = useEnv();
	const logger = useLogger();
	if (env["CACHE_AUTO_FLUSH_ON_DEPLOY"] !== true) return;
	if (env["CACHE_ENABLED"] !== true || env["CACHE_STORE"] !== "redis") return;
	try {
		const { lockCache } = getCache();
		const identity = await computeBuildIdentity(extensionManager);
		if (await lockCache.get(BUILD_IDENTITY_KEY) === identity) return;
		if (await lockCache.get(BUILD_IDENTITY_FLUSH_LOCK)) return;
		await lockCache.set(BUILD_IDENTITY_FLUSH_LOCK, true, FLUSH_LOCK_MS);
		if (await lockCache.get(BUILD_IDENTITY_KEY) === identity) {
			await lockCache.delete(BUILD_IDENTITY_FLUSH_LOCK);
			return;
		}
		logger.info("[cache] Build identity changed since last boot, flushing");
		const budget = getMilliseconds(env["CACHE_AUTO_FLUSH_ON_DEPLOY_TIMEOUT"], 3e4);
		let waited;
		const outcome = await Promise.race([flushHoldingTheLock(identity).catch((error) => {
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

//#endregion
export { computeBuildIdentity, flushCachesIfBuildChanged };