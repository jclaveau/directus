import { useLogger } from '../../logger/index.js';

/** The slice of an ioredis / node-redis client this needs: two events. */
export interface ConnectionEvents {
	on(event: 'error', listener: (error: Error) => void): unknown;
	on(event: 'ready', listener: () => void): unknown;
}

/** What something built on that connection reports when its own calls hit it. */
interface ConnectionFailures {
	on(event: 'error', listener: (error: Error) => void): unknown;
}

/**
 * Give a Redis client the `error` listener it cannot live without, and log at most
 * one line per distinct failure per outage.
 *
 * The listener is not optional, and what it prevents depends on the client. A
 * node-redis one — the four `@keyv/redis` stores — emits `error` as a plain
 * EventEmitter, so with nobody listening an unreachable Redis rethrows and exits a
 * process that was serving requests fine. ioredis routes connection errors through
 * `silentEmit`, which does not throw; it writes the stack to stderr with
 * `console.error` instead, outside the logger, unlevelled and unredacted.
 *
 * The throttling is what makes either survivable for a day rather than a minute.
 * The default retry policy never gives up (`REDIS_RETRY_MAX_ATTEMPTS` unset) and
 * every failed reconnect reports, so an outage writes for as long as it lasts —
 * 124 stack dumps in 25 seconds, measured on one unlistened client. Every distinct
 * failure is still reported once: `ECONNREFUSED` turning into an auth failure is
 * news, not repetition.
 *
 * A store built on the connection can be handed over with it. Keyv reports what its
 * own commands hit, which during an outage is one error per refused command and so
 * grows with traffic rather than with the failure; folded in here it shares the
 * throttle, the label and the reconnect that ends them both.
 *
 * Which of the two raised a line is written into the line rather than into a second
 * label, so provenance costs nothing in volume. They are not throttled apart though:
 * the same failure text arriving from both sides is one failure seen twice, and
 * counting it twice is how a log starts growing with traffic again.
 */
export function warnOncePerConnectionOutage(
	client: ConnectionEvents,
	connectionLabel: string,
	store?: ConnectionFailures,
): void {
	// Every distinct failure of this outage, not just the last one. A single slot
	// collapses repeats and nothing else, and an outage does not repeat: a refused
	// command and the reconnect racing it report different things turn and turn about,
	// which alternate past a one-slot check and log every time. Bounded by how many
	// ways one connection can fail, and emptied when it comes back.
	const reported = new Set<string>();

	function warnOnce(origin: 'connection' | 'store', error: Error) {
		// Named as well as worded: a dual-stack connect fails as an `AggregateError`
		// carrying no message of its own, so the message alone cannot tell one
		// message-less failure from another and would collapse them into one line.
		const failure = `${error.name}: ${error.message}`;

		if (reported.has(failure)) {
			return;
		}

		reported.add(failure);
		useLogger().warn(error, `[${connectionLabel}] ${origin}: ${error}`);
	}

	// A socket that dropped, versus a command the store could not send over one. The
	// difference decides whether you go and look at Redis or at what the app asked of
	// it, and it is invisible once both are called the same thing.
	client.on('error', (error) => warnOnce('connection', error));
	store?.on('error', (error) => warnOnce('store', error));

	// Reconnected, so the next outage is reported from scratch rather than being
	// mistaken for a continuation of this one.
	client.on('ready', () => {
		reported.clear();
	});
}
