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

// The response cache lives in an external redis and survives a container swap, so
// a code-only deploy — a hook/extension or a core (fork) reshaping change shipped
// with no migration and no directus/version bump — keeps serving the previous
// build's response shape until CACHE_TTL expires. flushCaches() otherwise runs
// only from the migration runner. On boot we fingerprint the running build and
// flush the caches once when that fingerprint changed, so the deploy self-heals.

const BUILD_IDENTITY_KEY = 'build-identity';
const BUILD_IDENTITY_FLUSH_LOCK = 'build-identity-flush-lock';

// The git commit baked into the dist by tsdown's `define` (see tsdown.config.ts).
// A string in a shipped build, undefined in an unbundled dev run where the token
// is never replaced.
declare const __DIRECTUS_BUILD_COMMIT__: string | undefined;

// Case B (core/fork logic): directus/version is intentionally pinned on the fork's
// version line, so it can't detect a core reshaping change on its own. Resolve, in
// order: an explicit override, the commit baked into the dist at build time (travels
// with the build on any platform), the commit the platform injects at deploy time,
// then the version string so a plain upstream version bump still moves the id.
function resolveCoreBuildId(): string {
	// TODO(reviewer): CACHE_BUILD_ID is probably overkill now the commit is baked —
	// baked → railway → version already self-heals. Kept as a manual force/suppress
	// escape hatch (bump to flush, pin to freeze); drop if we never reach for it.
	const explicit = useEnv()['CACHE_BUILD_ID'];

	if (typeof explicit === 'string' && explicit.length > 0) {
		return explicit;
	}

	if (typeof __DIRECTUS_BUILD_COMMIT__ === 'string') {
		const baked = __DIRECTUS_BUILD_COMMIT__;

		if (baked) {
			return baked;
		}
	}

	// A platform-injected git SHA is not part of the directus env schema, so read it
	// off process.env.
	const gitCommitSha = process.env['RAILWAY_GIT_COMMIT_SHA'];

	if (typeof gitCommitSha === 'string' && gitCommitSha.length > 0) {
		return gitCommitSha;
	}

	return version;
}

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
		// flushCaches() leaves untouched. Non-atomic get-then-set: a loser returns
		// here trusting the holder to flush, so two deploys inside the 30s lock can
		// drop the later flush — bounded by CACHE_TTL, accepted.
		if (await lockCache.get(BUILD_IDENTITY_FLUSH_LOCK)) {
			return;
		}

		await lockCache.set(BUILD_IDENTITY_FLUSH_LOCK, true, 30000);

		// Re-read under the lock: another instance may have flushed and stored the
		// new id since our check.
		if ((await lockCache.get(BUILD_IDENTITY_KEY)) === identity) {
			await lockCache.delete(BUILD_IDENTITY_FLUSH_LOCK);
			return;
		}

		logger.info('[cache] Build identity changed since last boot, flushing');

		await flushCaches(true);
		await lockCache.set(BUILD_IDENTITY_KEY, identity);
		await lockCache.delete(BUILD_IDENTITY_FLUSH_LOCK);
	}
	catch (err) {
		logger.warn(err, '[cache] build-identity self-heal failed');
	}
}
