import { useLogger } from '../logger/index.js';
import { useMetrics } from '../metrics/index.js';

/**
 * How long the same failure goes without earning another line.
 *
 * The volume follows traffic rather than the failure: one rejection per command a
 * dead dependency refuses, and ioredis flushes its whole queue at once — seven lines
 * a flush from an idle autoscaler, and a process that is serving refuses as many
 * commands as it is asked for. A minute is often enough to show an outage is still
 * going and rare enough to read.
 */
const REPEAT_AFTER_MS = 60_000;

/**
 * How many distinct failures are remembered before the throttle starts over.
 *
 * A failure carrying an id or a key in its message is a different failure every
 * time, and would otherwise grow this map for as long as the process runs.
 */
const DISTINCT_FAILURES_KEPT = 100;

const logged = new Map<string, { at: number; suppressed: number }>();

/**
 * What the process does with a promise rejection nothing awaited.
 *
 * Node turns one into an uncaught exception, and the API has no shortage of promises
 * nothing awaits — a scheduled tick, a fire-and-forget telemetry write, a client
 * library settling a command long after its caller gave up. Each is a way for a
 * background dependency to exit a process that was serving requests fine: an
 * unreachable Redis alone reached it through the shared ioredis client, the bus
 * subscriber, the Keyv stores and the scheduler, each fixed at its own site and none
 * of which was the last one.
 *
 * Logged at error, never silently: the point is to keep a background failure from
 * killing the foreground, not to stop hearing about it. Throttled to one line per
 * distinct failure per minute, because a dependency that is down rejects once per
 * command asked of it — the counter is what carries the volume, and the line that
 * ends a window says how much it swallowed.
 */
export function reportUnhandledRejection(reason: unknown): void {
	// Counted before anything is decided about logging, and counted every time: the
	// log says what is failing, the counter says how much, and throttling the first
	// is what leaves the second the only honest volume. Rising after a deploy is the
	// signal that a new floating promise shipped.
	useMetrics()
		?.getUnhandledRejectionMetric()
		.inc();

	// Named as well as worded, like the connection warner: a failure carrying no
	// message of its own cannot be told from any other by its message, and they
	// would collapse into one throttled line.
	const failure = reason instanceof Error
		? `${reason.name}: ${reason.message}`
		: String(reason);

	const now = Date.now();
	const seen = logged.get(failure);

	if (seen !== undefined && now - seen.at < REPEAT_AFTER_MS) {
		seen.suppressed += 1;

		return;
	}

	if (logged.size >= DISTINCT_FAILURES_KEPT) {
		logged.clear();
	}

	const repeats = seen?.suppressed ?? 0;
	logged.set(failure, { at: now, suppressed: 0 });

	// A rejection is not required to be an Error, and pino reads a primitive first
	// argument as the message and drops the second — so an unwrapped `reject('boom')`
	// logs `boom` and loses the words that say what happened.
	const reported = reason instanceof Error
		? reason
		: { reason };

	// What the window swallowed is counted into the line that ends it, so an
	// outage's size reads off the log and not only off the counter.
	const line = repeats === 0
		? `Unhandled promise rejection: ${reason}`
		: `Unhandled promise rejection: ${reason} (${repeats} more since the last)`;

	useLogger().error(reported, line);
}
