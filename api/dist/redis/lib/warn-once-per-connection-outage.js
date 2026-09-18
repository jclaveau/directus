import { useLogger } from "../../logger/index.js";

//#region src/redis/lib/warn-once-per-connection-outage.ts
/**
* Give a Redis client an `error` listener, and log at most one line per distinct
* failure per outage.
*
* What it buys is a readable log rather than survival — a claim this module carried
* for a while and got wrong twice. ioredis routes connection errors through
* `silentEmit`, which does not throw at an empty listener list; it writes the stack
* to stderr with `console.error` instead, outside the logger, unlevelled and
* unredacted. A node-redis client is never unlistened at all, because `@keyv/redis`
* attaches to it from its own constructor. What did end the process was unhandled
* *rejections*, which is a different fix in `utils/report-unhandled-rejection.ts`
* and `utils/schedule.ts`.
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
function warnOncePerConnectionOutage(client, connectionLabel, store) {
	const reported = /* @__PURE__ */ new Set();
	function warnOnce(origin, error) {
		const failure = `${error.name}: ${error.message}`;
		if (reported.has(failure)) return;
		reported.add(failure);
		useLogger().warn(error, `[${connectionLabel}] ${origin}: ${error}`);
	}
	const raisedByConnection = /* @__PURE__ */ new WeakSet();
	client.on("error", (error) => {
		raisedByConnection.add(error);
		warnOnce("connection", error);
	});
	store?.on("error", (error) => {
		queueMicrotask(() => {
			if (raisedByConnection.has(error)) return;
			warnOnce("store", error);
		});
	});
	client.on("ready", () => {
		reported.clear();
	});
}

//#endregion
export { warnOncePerConnectionOutage };