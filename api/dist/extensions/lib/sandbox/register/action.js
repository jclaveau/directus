import emitter_default from "../../../../emitter.js";
import { callReference } from "./call-reference.js";

//#region src/extensions/lib/sandbox/register/action.ts
function registerActionGenerator() {
	const unregisterFunctions = [];
	const registerAction = (event, cb) => {
		if (event.typeof !== "string") throw new TypeError("Action event has to be of type string");
		if (cb.typeof !== "function") throw new TypeError("Action handler has to be of type function");
		const eventCopied = event.copySync();
		const handler = (payload) => callReference(cb, [payload]);
		emitter_default.onAction(eventCopied, handler);
		unregisterFunctions.push(() => {
			emitter_default.offAction(eventCopied, handler);
		});
	};
	return {
		register: registerAction,
		unregisterFunctions
	};
}

//#endregion
export { registerActionGenerator };