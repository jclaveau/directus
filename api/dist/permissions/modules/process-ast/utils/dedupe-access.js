import hash from "object-hash";

//#region src/permissions/modules/process-ast/utils/dedupe-access.ts
/**
* Deduplicate the permissions sets by merging the field sets based on the access control rules
* (`permissions` in Permission rows)
*
* This allows the cases injection to be more efficient by not having to generate duplicate
* case/when clauses for permission sets where the rule access is identical
*/
function dedupeAccess(permissions) {
	const map = /* @__PURE__ */ new Map();
	for (const permission of permissions) {
		const rule = permission.permissions ?? {};
		const ruleHash = hash(rule, {
			algorithm: "passthrough",
			unorderedArrays: true
		});
		if (map.has(ruleHash) === false) map.set(ruleHash, {
			rule,
			fields: /* @__PURE__ */ new Set()
		});
		const info = map.get(ruleHash);
		for (const field of permission.fields ?? []) info.fields.add(field);
	}
	return Array.from(map.values());
}

//#endregion
export { dedupeAccess };