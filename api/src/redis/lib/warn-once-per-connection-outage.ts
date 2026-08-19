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
 * 124 stack dumps in 25 seconds, measured on one unlistened client. A changed
 * failure is still reported: `ECONNREFUSED` turning into an auth failure is news,
 * not repetition.
 *
 * A consumer of the connection can be handed over with it. A Keyv store reports what
 * its own commands hit, which during an outage is one error per refused command and
 * so grows with traffic rather than with the failure; folded in here it shares the
 * throttle, the label and the reconnect that ends them both.
 */
export function warnOncePerConnectionOutage(
	client: ConnectionEvents,
	connectionLabel: string,
	consumer?: ConnectionFailures,
): void {
	let reported: string | null = null;

	function warnOnce(error: Error) {
		// Named as well as worded: a dual-stack connect fails as an `AggregateError`
		// carrying no message of its own, so the message alone cannot tell one
		// message-less failure from another and would collapse them into one line.
		const failure = `${error.name}: ${error.message}`;

		if (failure === reported) {
			return;
		}

		reported = failure;
		useLogger().warn(error, `[${connectionLabel}] ${error}`);
	}

	client.on('error', warnOnce);
	consumer?.on('error', warnOnce);

	// Reconnected, so the next outage is reported from scratch rather than being
	// mistaken for a continuation of this one.
	client.on('ready', () => {
		reported = null;
	});
}
