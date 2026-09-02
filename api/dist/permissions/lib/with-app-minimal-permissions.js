import { filterItems } from "../../utils/filter-items.js";
import { cloneDeep } from "lodash-es";
import { appAccessMinimalPermissions } from "@directus/system-data";

//#region src/permissions/lib/with-app-minimal-permissions.ts
function withAppMinimalPermissions(accountability, permissions, filter) {
	if (accountability?.app === true) {
		const filteredAppMinimalPermissions = cloneDeep(filterItems(appAccessMinimalPermissions, filter));
		return [...permissions, ...filteredAppMinimalPermissions];
	}
	return permissions;
}

//#endregion
export { withAppMinimalPermissions };