import { setTimeout } from "node:timers/promises";

//#region src/extensions/lib/sandbox/sdk/generators/sleep.ts
function sleepGenerator(requestedScopes) {
	return async (milliseconds) => {
		if (requestedScopes.sleep === void 0) throw new Error("No permission to access \"sleep\"");
		if (milliseconds.typeof !== "number") throw new TypeError("Sleep milliseconds has to be of type number");
		await setTimeout(await milliseconds.copy());
	};
}

//#endregion
export { sleepGenerator };