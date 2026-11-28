import { parseFilter, validatePayload } from "@directus/utils";
import { FailedValidationError, joiValidationErrorItemToErrorExtensions } from "@directus/validation";
import { defineOperationApi } from "@directus/extensions";

//#region src/operations/condition/index.ts
var condition_default = defineOperationApi({
	id: "condition",
	handler: ({ filter }, { data, accountability }) => {
		const parsedFilter = parseFilter(filter, accountability, void 0, true);
		if (!parsedFilter) return null;
		const errors = validatePayload(parsedFilter, data, { requireAll: true });
		if (errors.length > 0) throw errors.map((error) => error.details.map((details) => new FailedValidationError(joiValidationErrorItemToErrorExtensions(details)))).flat();
		else return null;
	}
});

//#endregion
export { condition_default as default };