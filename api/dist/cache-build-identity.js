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
	return "b2ba1789fefdd68a561167d16c743a5de0fea0c9";
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
		await lockCache.set(BUILD_IDENTITY_FLUSH_LOCK, true, 3e4);
		if (await lockCache.get(BUILD_IDENTITY_KEY) === identity) {
			await lockCache.delete(BUILD_IDENTITY_FLUSH_LOCK);
			return;
		}
		logger.info("[cache] Build identity changed since last boot, flushing");
		await flushCaches(true);
		await lockCache.set(BUILD_IDENTITY_KEY, identity);
		await lockCache.delete(BUILD_IDENTITY_FLUSH_LOCK);
	} catch (err) {
		logger.warn(err, "[cache] build-identity self-heal failed");
	}
}

//#endregion
export { computeBuildIdentity, flushCachesIfBuildChanged };