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
 * The listener itself is not optional: an EventEmitter with no `error` handler
 * rethrows, so an unreachable Redis exits a process that was serving requests fine.
 * Every consumer already survives a failed command — a read falls through to a MISS,
 * a purge is recorded and retried — which is only reachable if the process is alive
 * to do it.
 *
 * The throttling is what makes that survivable for a day rather than a minute. The
 * default retry policy never gives up (`REDIS_RETRY_MAX_ATTEMPTS` unset), and each
 * failed reconnect emits an error, so an outage would otherwise write a warning
 * every couple of seconds for as long as it lasts — across the shared client, the
 * bus subscriber and one client per Keyv store. A changed failure is still reported:
 * `ECONNREFUSED` turning into an auth failure is news, not repetition.
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
