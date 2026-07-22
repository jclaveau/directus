import { API_EXTENSION_TYPES, HYBRID_EXTENSION_TYPES } from '@directus/constants';
import { useEnv } from '@directus/env';
import type { Extension } from '@directus/types';
import { isTypeIn } from '@directus/utils';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { version } from 'directus/version';
import { flushCaches, getCache } from './cache.js';
import type { ExtensionManager } from './extensions/manager.js';
import { useLogger } from './logger/index.js';

// The response cache lives in an external redis and survives a container swap, so a code-only deploy
// — a hook/extension or a core (fork) reshaping change that ships with no migration and no
// directus/version bump — keeps serving the previous build's response shape until CACHE_TTL expires.
// flushCaches() otherwise runs only from the migration runner. On boot we fingerprint the running
// build and flush the caches once when that fingerprint changed, so a code-only deploy self-heals.

const BUILD_IDENTITY_KEY = 'build-identity';
const BUILD_IDENTITY_FLUSH_LOCK = 'build-identity-flush-lock';

// Case B (core/fork logic): directus/version is intentionally pinned on the fork's version line, so it
// can't detect a core reshaping change on its own. Prefer an explicit build id, then the commit the
// platform injects at deploy time (Railway sets RAILWAY_GIT_COMMIT_SHA from git), then fall back to
// the version string so a plain upstream version bump still moves the identity.
function resolveCoreBuildId(): string {
	const explicit = useEnv()['CACHE_BUILD_ID'];

	if (typeof explicit === 'string' && explicit.length > 0) {
		return explicit;
	}

	// A platform-injected git SHA is not part of the directus env schema, so read it off process.env.
	const gitCommitSha = process.env['RAILWAY_GIT_COMMIT_SHA'];

	if (typeof gitCommitSha === 'string' && gitCommitSha.length > 0) {
		return gitCommitSha;
	}

	return version;
}

// Only api-side extension code can reshape a read response; an app-only extension (interface, display,
// layout, module, panel, theme) never runs server-side, so it can't move the cached shape. Hook and
// endpoint carry a single string entrypoint; operation (hybrid) and bundle split app/api and only the
// api side matters here.
function apiEntrypointFile(extension: Extension): string | null {
	if (isTypeIn(extension, API_EXTENSION_TYPES)) {
		return path.resolve(extension.path, extension.entrypoint);
	}

	if (isTypeIn(extension, HYBRID_EXTENSION_TYPES) || extension.type === 'bundle') {
		return path.resolve(extension.path, extension.entrypoint.api);
	}

	return null;
}

// Case A (extensions): a content hash of every loaded api-side extension bundle, so an extension logic
// change busts the fingerprint even when its name/version and the directus version all stay put.
async function hashApiExtensions(extensionManager: ExtensionManager): Promise<string> {
	const hash = createHash('sha1');

	const apiExtensions = extensionManager.extensions
		.map((extension) => ({ extension, file: apiEntrypointFile(extension) }))
		.filter((entry): entry is { extension: Extension; file: string } => entry.file !== null)
		.sort((a, b) => a.extension.name.localeCompare(b.extension.name));

	for (const { extension, file } of apiExtensions) {
		hash.update(`${extension.name}\0${extension.version ?? ''}\0${extension.type}\0`);

		try {
			hash.update(await readFile(file));
		}
		catch {
			// A bundle we can't read still contributes its identity above; a read failure must not
			// silently collapse two different builds onto the same fingerprint.
			hash.update('<unreadable>');
		}
	}

	return hash.digest('hex');
}

export async function computeBuildIdentity(extensionManager: ExtensionManager): Promise<string> {
	const core = resolveCoreBuildId();
	const extensions = await hashApiExtensions(extensionManager);

	return createHash('sha1').update(`${core}\0${extensions}`).digest('hex');
}

export async function flushCachesIfBuildChanged(extensionManager: ExtensionManager): Promise<void> {
	const env = useEnv();
	const logger = useLogger();

	if (env['CACHE_AUTO_FLUSH_ON_DEPLOY'] !== true) {
		return;
	}

	// Only a redis response cache survives a container swap; a memory store boots empty, so there is
	// never a stale-shaped entry to heal, and there is no shared store to persist the fingerprint in.
	if (env['CACHE_ENABLED'] !== true || env['CACHE_STORE'] !== 'redis') {
		return;
	}

	const { lockCache } = getCache();
	const identity = await computeBuildIdentity(extensionManager);

	if ((await lockCache.get(BUILD_IDENTITY_KEY)) === identity) {
		return;
	}

	// Redis-gate so exactly one instance flushes when several boot together on a deploy. The lock and
	// the stored fingerprint both live in lockCache, which flushCaches() leaves untouched.
	if (await lockCache.get(BUILD_IDENTITY_FLUSH_LOCK)) {
		return;
	}

	await lockCache.set(BUILD_IDENTITY_FLUSH_LOCK, true, 30000);

	// Re-read under the lock: another instance may have flushed and stored the new id since our check.
	if ((await lockCache.get(BUILD_IDENTITY_KEY)) === identity) {
		await lockCache.delete(BUILD_IDENTITY_FLUSH_LOCK);
		return;
	}

	logger.info('[cache] Build identity changed since last boot, flushing caches');

	await flushCaches(true);
	await lockCache.set(BUILD_IDENTITY_KEY, identity);
	await lockCache.delete(BUILD_IDENTITY_FLUSH_LOCK);
}
