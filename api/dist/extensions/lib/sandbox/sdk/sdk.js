import { logGenerator } from "./generators/log.js";
import { requestGenerator } from "./generators/request.js";
import { sleepGenerator } from "./generators/sleep.js";
import "./generators/index.js";

//#region src/extensions/lib/sandbox/sdk/sdk.ts
/**
* Create a new SDK context for use in the isolate
*/
function getSdk() {
	return [
		{
			name: "log",
			generator: logGenerator,
			args: ["message"],
			async: false
		},
		{
			name: "sleep",
			generator: sleepGenerator,
			args: ["milliseconds"],
			async: true
		},
		{
			name: "request",
			generator: requestGenerator,
			args: ["url", "options"],
			async: true
		}
	];
}

//#endregion
export { getSdk };