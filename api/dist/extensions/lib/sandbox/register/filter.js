import emitter_default from "../../../../emitter.js";
import { callReference } from "./call-reference.js";

//#region src/extensions/lib/sandbox/register/filter.ts
function registerFilterGenerator() {
	const unregisterFunctions = [];
	const registerFilter = (event, cb) => {
		if (event.typeof !== "string") throw new TypeError("Filter event has to be of type string");
		if (cb.typeof !== "function") throw new TypeError("Filter handler has to be of type function");
		const eventCopied = event.copySync();
		const handler = async (payload) => {
			return (await callReference(cb, [payload])).copy();
		};
		emitter_default.onFilter(eventCopied, handler);
		unregisterFunctions.push(() => {
			emitter_default.offFilter(eventCopied, handler);
		});
	};
	return {
		register: registerFilter,
		unregisterFunctions
	};
}

//#endregion
export { registerFilterGenerator };