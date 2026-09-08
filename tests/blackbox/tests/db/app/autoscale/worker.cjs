// A pm2 app for the autoscaler suites, whose CPU is a knob rather than a workload.
//
// The autoscaler reads three things about a pool — how many workers there are, how
// hot they run, and whether the newest one has reported ready. Directus answers all
// three, but only after a boot whose own cost is the thing under test, and only at a
// CPU nobody controls. This answers them on demand instead: BB_BUSY_MS of a spin per
// BB_IDLE_MS of sleep is a duty cycle the daemon reports as a stable percentage.

const busyMs = Number(process.env['BB_BUSY_MS'] ?? 0);
const idleMs = Number(process.env['BB_IDLE_MS'] ?? 100);
const readyDelayMs = Number(process.env['BB_READY_DELAY_MS'] ?? 200);

// Reported the way the API reports it, from a timer instead of a `listen` callback,
// so `wait_ready` holds each new worker at `launching` for as long as a real boot.
setTimeout(() => process.send?.('ready'), readyDelayMs);

function burn() {
	const until = Date.now() + busyMs;

	while (Date.now() < until);

	setTimeout(burn, idleMs);
}

if (busyMs > 0) burn();
else setInterval(() => {}, 60_000);
