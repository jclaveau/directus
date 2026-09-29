import { scopedCachePurgeEnabled } from './config.js';
import { requestScopedCacheIndexReap } from './reap-requests.js';

// When this process may fill again. Null until the boot has read the build back
// from Redis: a fill before that could be this build's first during a deploy.
let fillsPausedUntil: number | null = null;
let pauseEndTimer: NodeJS.Timeout | null = null;

/**
 * Whether this process must serve its reads uncached for now: a build other than
 * the last one recorded booted less than `CACHE_SCOPED_DEPLOY_FILL_PAUSE` ago,
 * and the nodes of the build before may still be filing sets this build's purges
 * reach only by a SCAN, while theirs never reach what this build files.
 *
 * Also while the boot has not yet recorded the build: a Redis down at boot keeps
 * it paused until the reconnect records it, which costs no fills that Redis could
 * have taken.
 */
export function scopedCacheFillPaused(): boolean {
	if (!scopedCachePurgeEnabled()) {
		return false;
	}

	return fillsPausedUntil === null || Date.now() < fillsPausedUntil;
}

/**
 * Hold this process's fills for what the recorded build says is left of the
 * pause, 0 for none, and ask for a reap as it closes: the one that names what
 * the build before filed, and writes the completeness marker the pause held back.
 */
export function pauseScopedCacheFills(fillPauseLeftMs: number): void {
	fillsPausedUntil = Date.now() + fillPauseLeftMs;

	if (pauseEndTimer !== null) {
		clearTimeout(pauseEndTimer);
		pauseEndTimer = null;
	}

	if (fillPauseLeftMs > 0) {
		pauseEndTimer = setTimeout(() => {
			pauseEndTimer = null;
			void requestScopedCacheIndexReap();
		}, fillPauseLeftMs);

		pauseEndTimer.unref();
	}
}
