import { fetchPolicies } from "../../lib/fetch-policies.js";
import { fetchPermissions } from "../../lib/fetch-permissions.js";
import { mapValues, uniq } from "lodash-es";
import { PERMISSION_ACTIONS } from "@directus/constants";

//#region src/permissions/modules/fetch-accountability-collection-access/fetch-accountability-collection-access.ts
/**
* Get all permissions + minimal app permissions (if applicable) for the user + role in the current accountability.
* The permissions will be filtered by IP access.
*/
async function fetchAccountabilityCollectionAccess(accountability, context) {
	if (accountability.admin) return mapValues(context.schema.collections, () => Object.fromEntries(PERMISSION_ACTIONS.map((action) => [action, {
		access: "full",
		fields: ["*"]
	}])));
	const permissions = await fetchPermissions({
		policies: await fetchPolicies(accountability, context),
		accountability
	}, context);
	const infos = {};
	for (const perm of permissions) {
		if (!infos[perm.collection]) infos[perm.collection] = {
			read: { access: "none" },
			create: { access: "none" },
			update: { access: "none" },
			delete: { access: "none" },
			share: { access: "none" }
		};
		if (infos[perm.collection][perm.action]?.access === "none") infos[perm.collection][perm.action].access = "full";
		const info = infos[perm.collection][perm.action];
		if (info.access === "full" && perm.permissions && Object.keys(perm.permissions).length > 0) info.access = "partial";
		if (perm.fields && info.fields?.[0] !== "*") {
			info.fields = uniq([...info.fields || [], ...perm.fields || []]);
			if (info.fields.includes("*")) info.fields = ["*"];
		}
		if (perm.presets) info.presets = {
			...info.presets ?? {},
			...perm.presets
		};
	}
	return infos;
}

//#endregion
export { fetchAccountabilityCollectionAccess };