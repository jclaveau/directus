import { getAuthProviders } from "./get-auth-providers.js";
import { systemFieldRows } from "@directus/system-data";
import formatTitle from "@directus/format-title";

//#region src/utils/get-field-system-rows.ts
function getSystemFieldRowsWithAuthProviders() {
	return systemFieldRows.map((systemField) => {
		if (systemField.collection === "directus_users" && systemField.field === "provider") {
			if (!systemField.options) systemField.options = {};
			systemField.options["choices"] = getAuthProviders().map(({ name }) => ({
				text: formatTitle(name),
				value: name
			}));
		}
		return systemField;
	});
}

//#endregion
export { getSystemFieldRowsWithAuthProviders };