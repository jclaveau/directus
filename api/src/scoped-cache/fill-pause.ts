import { useLogger } from '../logger/index.js';
import { collectProcessReports } from '../processes/lib/collect-processes.js';
import { nodeId } from '../utils/node-id.js';
import { scopedCachePurgeEnabled } from './config.js';
import { requestScopedCacheIndexReap } from './reap-requests.js';
import { useScopedCacheStore } from './store.js';

/** How often a paused node looks at the pause, and its watcher at the processes. */
const FILL_PAUSE_LOOK_MS = 5_000;

/**
 * Looks in a row with no process of another build answering before the pause
 * ends. A node of the build before too busy to answer within
 * `PROCESSES_COLLECT_TIMEOUT` misses one look, and ending on it would let this
 * build fill beside it.
 */
const QUIET_LOOKS_TO_RESUME = 3;

/** Outlives two missed looks, so only a watcher that died hands the watch on. */
const FILL_PAUSE_WATCH_MS = FILL_PAUSE_LOOK_MS * 3;

// When this process may fill again. Null until the boot has read the build back
// from Redis: a fill before that could be this build's first during a deploy.
let fillsPausedUntil: number | null = null;
let fillPauseStartedAt = 0;
let pauseLookTimer: NodeJS.Timeout | null = null;
let quietLooks = 0;
let lookRunning = false;

/**
 * Whether this process must serve its reads uncached for now: a build other than
 * the last one recorded booted, and a process of the build before still
 * answers, so it may still be filing sets this build's purges reach only by a
 * SCAN, while its purges never reach what this build files. At most
 * `CACHE_SCOPED_DEPLOY_FILL_PAUSE_MAX`.
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
 * Hold this process's fills for at most what the recorded build says is left of
 * the pause, 0 for none, and look at it every `FILL_PAUSE_LOOK_MS` until it
 * ends: by its watcher, once no process of another build answered
 * `QUIET_LOOKS_TO_RESUME` looks in a row, or at its ceiling.
 */
export function pauseScopedCacheFills(
	fillPauseLeftMs: number,
	buildIdentity: string,
): void {
	stopLookingAtFillPause();
	quietLooks = 0;
	fillsPausedUntil = Date.now() + fillPauseLeftMs;

	if (fillPauseLeftMs <= 0) {
		return;
	}

	fillPauseStartedAt = Date.now();

	pauseLookTimer = setInterval(() => {
		void lookAtFillPause(buildIdentity);
	}, FILL_PAUSE_LOOK_MS);

	pauseLookTimer.unref();
}

function stopLookingAtFillPause(): void {
	if (pauseLookTimer !== null) {
		clearInterval(pauseLookTimer);
		pauseLookTimer = null;
	}
}

async function lookAtFillPause(buildIdentity: string): Promise<void> {
	// A look outlasting the tick, the collect's wait with a slow Redis, is
	// answered by itself.
	if (lookRunning) {
		return;
	}

	lookRunning = true;

	try {
		if (Date.now() >= fillsPausedUntil!) {
			resumeScopedCacheFills('at its ceiling');
			return;
		}

		const store = useScopedCacheStore();

		const { fillPauseLeftMs, watching } = await store.watchFillPause(
			nodeId,
			FILL_PAUSE_WATCH_MS,
		);

		if (fillPauseLeftMs === 0) {
			resumeScopedCacheFills('ended by its watcher');
			return;
		}

		fillsPausedUntil = Date.now() + fillPauseLeftMs;

		if (!watching) {
			return;
		}

		quietLooks = await onlyThisBuildAnswers(buildIdentity)
			? quietLooks + 1
			: 0;

		if (
			quietLooks >= QUIET_LOOKS_TO_RESUME
			&& await store.endFillPause(buildIdentity)
		) {
			resumeScopedCacheFills(
				`once no process of another build answered ${quietLooks} looks`,
			);
		}
	}
	catch (error) {
		// Paused still, until a look that reaches Redis or the ceiling.
		useLogger().warn(
			error,
			`[scoped-cache] looking at the fill pause failed: ${error}`,
		);
	}
	finally {
		lookRunning = false;
	}
}

/**
 * Whether every process answering on the bus runs this build. Its own answer
 * is required: without it the query reached no one, reports are switched off
 * here (`PROCESSES_REPORT_ENABLED`), and a silence says nothing about the
 * build before. A process with no build in its report is older than the field.
 */
async function onlyThisBuildAnswers(buildIdentity: string): Promise<boolean> {
	const reports = await collectProcessReports([]);

	const answeredItself = reports.some((report) => {
		return report.self.nodeId === nodeId;
	});

	const otherBuildsAnswering = reports.filter((report) => {
		return report.self.coreBuildId !== buildIdentity;
	});

	return answeredItself && otherBuildsAnswering.length === 0;
}

/**
 * Fill again, and ask for the reap that names what the build before filed and
 * writes the completeness marker the pause held back.
 */
function resumeScopedCacheFills(endedHow: string): void {
	stopLookingAtFillPause();
	fillsPausedUntil = Date.now();

	useLogger().info(
		`[scoped-cache] fills resumed ${Date.now() - fillPauseStartedAt} ms into `
		+ `the pause after a deploy, ${endedHow}`,
	);

	void requestScopedCacheIndexReap();
}
