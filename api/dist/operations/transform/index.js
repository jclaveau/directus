import { optionToObject } from "@directus/utils";
import { defineOperationApi } from "@directus/extensions";

//#region src/operations/transform/index.ts
var transform_default = defineOperationApi({
	id: "transform",
	handler: ({ json }) => {
		return optionToObject(json);
	}
});

//#endregion
export { transform_default as default };