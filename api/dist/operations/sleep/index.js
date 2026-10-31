import { defineOperationApi } from "@directus/extensions";

//#region src/operations/sleep/index.ts
var sleep_default = defineOperationApi({
	id: "sleep",
	handler: async ({ milliseconds }) => {
		await new Promise((resolve) => setTimeout(resolve, Number(milliseconds)));
	}
});

//#endregion
export { sleep_default as default };