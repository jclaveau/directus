import { mergeFields } from "./merge-fields.js";
import { flatten, isEqual, merge, omit } from "lodash-es";

//#region src/permissions/utils/merge-permissions.ts
/**
* Merges multiple permission lists into a flat list of unique permissions.
* @param strategy `and` or `or` deduplicate permissions while `intersection` makes sure only common permissions across all lists are kept and overlapping permissions are merged through `and`.
* @param permissions List of permission lists to merge.
* @returns A flat list of unique permissions.
*/
function mergePermissions(strategy, ...permissions) {
	let allPermissions;
	if (strategy === "intersection") {
		const permissionKeys = permissions.map((permissions$1) => {
			return new Set(permissions$1.map((permission) => `${permission.collection}__${permission.action}`));
		});
		const intersectionKeys = permissionKeys.reduce((acc, val) => {
			return new Set([...acc].filter((x) => val.has(x)));
		}, permissionKeys[0]);
		allPermissions = flatten(permissions.map((permissions$1) => {
			return mergePermissions("or", permissions$1);
		})).filter((permission) => {
			return intersectionKeys.has(`${permission.collection}__${permission.action}`);
		});
		strategy = "and";
	} else allPermissions = flatten(permissions);
	const mergedPermissions = allPermissions.reduce((acc, val) => {
		const key = `${val.collection}__${val.action}`;
		const current = acc.get(key);
		acc.set(key, current ? mergePermission(strategy, current, val) : val);
		return acc;
	}, /* @__PURE__ */ new Map()).values();
	return Array.from(mergedPermissions);
}
function mergePermission(strategy, currentPerm, newPerm) {
	const logicalKey = `_${strategy}`;
	let { permissions, validation, fields, presets } = currentPerm;
	if (newPerm.permissions) if (currentPerm.permissions && Object.keys(currentPerm.permissions)[0] === logicalKey) permissions = { [logicalKey]: [...currentPerm.permissions[logicalKey], newPerm.permissions] };
	else if (currentPerm.permissions) if (strategy === "or" && (isEqual(currentPerm.permissions, {}) || isEqual(newPerm.permissions, {}))) permissions = {};
	else permissions = { [logicalKey]: [currentPerm.permissions, newPerm.permissions] };
	else permissions = { [logicalKey]: [newPerm.permissions] };
	if (newPerm.validation) if (currentPerm.validation && Object.keys(currentPerm.validation)[0] === logicalKey) validation = { [logicalKey]: [...currentPerm.validation[logicalKey], newPerm.validation] };
	else if (currentPerm.validation) if (strategy === "or" && (isEqual(currentPerm.validation, {}) || isEqual(newPerm.validation, {}))) validation = {};
	else validation = { [logicalKey]: [currentPerm.validation, newPerm.validation] };
	else validation = { [logicalKey]: [newPerm.validation] };
	fields = mergeFields(currentPerm.fields, newPerm.fields, strategy);
	if (newPerm.presets) presets = merge({}, presets, newPerm.presets);
	return omit({
		...currentPerm,
		permissions,
		validation,
		fields,
		presets
	}, ["id", "system"]);
}

//#endregion
export { mergePermission, mergePermissions };