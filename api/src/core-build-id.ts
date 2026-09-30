import { useEnv } from '@directus/env';
import { version } from 'directus/version';

// The git commit baked into the dist by tsdown's `define` (see tsdown.config.ts).
// A string in a shipped build, undefined in an unbundled dev run where the token
// is never replaced.
declare const __DIRECTUS_BUILD_COMMIT__: string | undefined;

// Case B (core/fork logic): directus/version is intentionally pinned on the fork's
// version line, so it can't detect a core reshaping change on its own. Resolve, in
// order: an explicit override, the commit baked into the dist at build time (travels
// with the build on any platform), the commit the platform injects at deploy time,
// then the version string so a plain upstream version bump still moves the id.
export function resolveCoreBuildId(): string {
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
