import { useLogger } from "../../../../../logger/index.js";

//#region src/extensions/lib/sandbox/sdk/generators/log.ts
function logGenerator(requestedScopes) {
	const logger = useLogger();
	return (message) => {
		if (requestedScopes.log === void 0) throw new Error("No permission to access \"log\"");
		if (message.typeof !== "string") throw new TypeError("Log message has to be of type string");
		const messageCopied = message.copySync();
		logger.info(messageCopied);
	};
}

//#endregion
export { logGenerator };