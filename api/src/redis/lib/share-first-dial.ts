/** The slice of a `@keyv/redis` store this needs: the client, and the dial. */
export interface DialingStore {
	client: {
		isOpen: boolean;
		once(event: 'error', listener: (error: Error) => void): unknown;
		off(event: 'error', listener: (error: Error) => void): unknown;
	};
	getClient(): Promise<unknown>;
}

/**
 * Make every command a store receives while it is dialing wait for the dial.
 *
 * `KeyvRedis.getClient()` hands the client over as soon as it is open, and
 * node-redis is open from the first byte it sends — so a command issued while the
 * store is still dialing reaches `sendCommand` before `ready`, where
 * `disableOfflineQueue` refuses it as offline. Since the stores dial as they are
 * built, the first command a fresh process sends is that command every time: on
 * production the lock `set` opening `clearSystemCache`, then the `clear` behind
 * it, warned on every `cache flush`, `migrate:latest` and `bootstrap`.
 *
 * The wait ends with the dial's first answer, `ready` or `error`, and never with
 * the reconnects behind it: node-redis retries a refused dial without end and
 * settles `connect()` only when it stops, so a process booting during an outage
 * would hold every cached read on it. After that first `error` the client is open
 * and reconnecting, which is the outage `disableOfflineQueue` refuses commands
 * during — the read fails open, as it does when Redis goes away later. A reconnect
 * is not a dial for the same reason: the client stays open through it and nothing
 * here is pending.
 */
export function shareFirstDial(store: DialingStore): void {
	const dial = store.getClient;
	let dialing: Promise<unknown> | undefined;

	store.getClient = async () => {
		if (dialing === undefined && !store.client.isOpen) {
			let refused: () => void = () => {};

			// The listener goes with the wait: left behind a dial that answered
			// `ready`, it would resolve a promise nobody waits on at the first outage.
			dialing = Promise.race([
				dial.call(store),
				new Promise<void>((resolve) => {
					refused = resolve;
					store.client.once('error', refused);
				}),
			]).finally(() => {
				store.client.off('error', refused);
				dialing = undefined;
			});
		}

		await dialing;
		return store.client;
	};
}
