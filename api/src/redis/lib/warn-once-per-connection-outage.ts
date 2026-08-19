import { useLogger } from '../../logger/index.js';

/** The slice of an ioredis / node-redis client this needs: two events. */
interface ConnectionEvents {
	on(event: 'error', listener: (error: Error) => void): unknown;
	on(event: 'ready', listener: () => void): unknown;
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
 * bus subscriber and one client per Keyv store. A changed message is still reported:
 * `ECONNREFUSED` turning into an auth failure is news, not repetition.
 */
export function warnOncePerConnectionOutage(
	client: ConnectionEvents,
	label: string,
): void {
	let reported: string | null = null;

	client.on('error', (error) => {
		if (error.message === reported) {
			return;
		}

		reported = error.message;
		useLogger().warn(error, `[${label}] ${error}`);
	});

	// Reconnected, so the next outage is reported from scratch rather than being
	// mistaken for a continuation of this one.
	client.on('ready', () => {
		reported = null;
	});
}
