import database_default from "../../../database/index.js";
import { ItemsService } from "../../../services/items.js";
import { getSchema } from "../../../utils/get-schema.js";
import "../../../services/index.js";
import { isEqual } from "lodash-es";
import { appRecommendedPermissions } from "@directus/system-data";

//#region src/license/entitlements/lib/custom-permission-rules-enabled.ts
function hasCustomRule(permission) {
	if (permission.system === true) return false;
	return permission.fields?.includes("*") !== true || Object.keys(permission.permissions ?? {}).length > 0 || Object.keys(permission.validation ?? {}).length > 0 || Object.keys(permission.presets ?? {}).length > 0;
}
function isRecommendedAppPermission(permission) {
	if (permission.validation || permission.presets) return false;
	const foundPermission = appRecommendedPermissions.find((p) => p.action === permission.action && p.collection === permission.collection);
	if (!foundPermission) return false;
	return isEqual(foundPermission.fields ?? null, permission.fields ?? null) && isEqual(foundPermission.permissions ?? null, permission.permissions ?? null);
}
async function checkCustomPermissionRules(opts) {
	const knex = opts?.knex ?? database_default();
	return (await new ItemsService("directus_permissions", {
		schema: await getSchema({ database: knex }),
		knex
	}).readByQuery({
		limit: -1,
		filter: { _or: [
			{ permissions: { _nnull: true } },
			{ validation: { _nnull: true } },
			{ presets: { _nnull: true } },
			{ fields: { _nnull: true } }
		] }
	})).filter((p) => hasCustomRule(p) && !isRecommendedAppPermission(p)).length === 0;
}

//#endregion
export { checkCustomPermissionRules, hasCustomRule, isRecommendedAppPermission };