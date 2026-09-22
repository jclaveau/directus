/** The slice of a `@keyv/redis` store this needs: the client, and the dial. */
export interface DialingStore {
	client: { isOpen: boolean };
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
 * A reconnect after an outage is not a dial: the client stays open through it and
 * nothing here is pending, so the command is refused as `disableOfflineQueue`
 * intends. A dial that fails still resolves, as the adapter's does — it reports
 * through the `error` the adapter forwards, and the command it lets through is
 * refused as closed.
 */
export function shareFirstDial(store: DialingStore): void {
	const dial = store.getClient;
	let dialing: Promise<unknown> | undefined;

	store.getClient = async () => {
		if (dialing === undefined && !store.client.isOpen) {
			dialing = dial.call(store).finally(() => (dialing = undefined));
		}

		await dialing;
		return store.client;
	};
}
