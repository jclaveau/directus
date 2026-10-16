import { useLogger } from "../../logger/index.js";
import { optionToString } from "@directus/utils";
import { defineOperationApi } from "@directus/extensions";

//#region src/operations/log/index.ts
var log_default = defineOperationApi({
	id: "log",
	handler: ({ message }) => {
		useLogger().info(optionToString(message));
	}
});

//#endregion
export { log_default as default };