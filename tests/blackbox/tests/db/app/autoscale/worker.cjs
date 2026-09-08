// A pm2 app for the autoscaler suites, whose CPU is a knob rather than a workload.
//
// The autoscaler reads three things about a pool — how many workers there are, how
// hot they run, and whether the newest one has reported ready. Directus answers all
// three, but only after a boot whose own cost is the thing under test, and only at a
// CPU nobody controls. This answers them on demand instead: BB_BUSY_MS of a spin per
// BB_IDLE_MS of sleep is a duty cycle the daemon reports as a stable percentage.

let busyMs = Number(process.env['BB_BUSY_MS'] ?? 0);
const idleMs = Number(process.env['BB_IDLE_MS'] ?? 100);
const readyDelayMs = Number(process.env['BB_READY_DELAY_MS'] ?? 200);
const crashAfterMs = Number(process.env['BB_CRASH_AFTER_MS'] ?? 0);

// `abort` is what a worker that exhausts its heap does: V8 prints
// `FATAL ERROR: Reached heap limit` and raises SIGABRT, which is how the
// planner's Api died on 2026-09-08 under `--max-old-space-size=1024`. What the
// supervisor records is a worker killed by a signal and restarted, and that is
// the whole of what the autoscaler reads — so this reproduces the observable
// without spending a runner's memory to get there.
// Which worker crashes, by pm2's own instance number. Unset means all of them.
// A pool where every worker is dying has no worker mature enough to report a
// CPU, so nothing there can tell the restart freeze from the warm-up freeze.
const crashInstance = process.env['BB_CRASH_ONLY_INSTANCE'];

const crashes = crashAfterMs > 0
	&& (crashInstance === undefined
		|| crashInstance === process.env['NODE_APP_INSTANCE']);

if (crashes) {
	setTimeout(() => process.abort(), crashAfterMs);
}

// Reported the way the API reports it, from a timer instead of a `listen` callback,
// so `wait_ready` holds each new worker at `launching` for as long as a real boot.
setTimeout(() => process.send?.('ready'), readyDelayMs);

// A pool that grew because it was hot only releases once it is not, and a duty
// cycle fixed at spawn can never stop being hot. This is the load going away:
// the same worker, still serving, reporting what an idle one reports.
const calmAfterMs = Number(process.env['BB_CALM_AFTER_MS'] ?? 0);

if (calmAfterMs > 0) {
	setTimeout(() => {
		busyMs = 0;
	}, calmAfterMs);
}

function burn() {
	const until = Date.now() + busyMs;

	while (Date.now() < until);

	setTimeout(burn, idleMs);
}

if (busyMs > 0) burn();
else setInterval(() => {}, 60_000);
