import { useBus } from "../../bus/lib/use-bus.js";
import "../../bus/index.js";
import { randomUUID } from "crypto";

//#region src/license/utils/use-rpc.ts
/**
* RPC means remote procedure call, allowing to call functions across multiple instances in a code native manner.
*
* Does not call the function on its OWN instance
*/
function useRPC(self, channel) {
	const uid = randomUUID();
	const messenger = useBus();
	messenger.subscribe(channel, async ({ uid: id, method, args }) => {
		if (uid == id) return;
		const fn = self[method];
		if (typeof fn === "function") try {
			await fn.apply(self, args);
		} catch {}
	});
	return new Proxy({}, { get(_, method) {
		return async (...args) => {
			await messenger.publish(channel, {
				uid,
				method,
				args
			});
		};
	} });
}

//#endregion
export { useRPC };