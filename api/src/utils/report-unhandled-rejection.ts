import { useLogger } from '../logger/index.js';
import { useMetrics } from '../metrics/index.js';

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
 * killing the foreground, not to stop hearing about it.
 */
export function reportUnhandledRejection(reason: unknown): void {
	// A rejection is not required to be an Error, and pino reads a primitive first
	// argument as the message and drops the second — so an unwrapped `reject('boom')`
	// logs `boom` and loses the words that say what happened.
	const reported = reason instanceof Error
		? reason
		: { reason };

	useLogger().error(reported, `Unhandled promise rejection: ${reason}`);

	// Counted as well as logged: a log line is where you look once you already suspect
	// something, a counter is what tells you to start looking. Rising after a deploy
	// is the signal that a new floating promise shipped.
	useMetrics()
		?.getUnhandledRejectionMetric()
		.inc();
}
