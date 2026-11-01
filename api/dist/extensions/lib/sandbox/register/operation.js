import { getFlowManager } from "../../../../flows.js";
import { callReference } from "./call-reference.js";

//#region src/extensions/lib/sandbox/register/operation.ts
function registerOperationGenerator() {
	const flowManager = getFlowManager();
	const unregisterFunctions = [];
	const registerOperation = (id, cb) => {
		if (id.typeof !== "string") throw new TypeError("Operation config id has to be of type string");
		if (cb.typeof !== "function") throw new TypeError("Operation config handler has to be of type function");
		const idCopied = id.copySync();
		const handler = async (options) => {
			return (await callReference(cb, [options])).copy();
		};
		flowManager.addOperation(idCopied, handler);
		unregisterFunctions.push(() => {
			flowManager.removeOperation(idCopied);
		});
	};
	return {
		register: registerOperation,
		unregisterFunctions
	};
}

//#endregion
export { registerOperationGenerator };