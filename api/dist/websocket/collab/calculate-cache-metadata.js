import { adjustDate } from "@directus/utils";
import { REGEX_BETWEEN_PARENS } from "@directus/constants";

//#region src/websocket/collab/calculate-cache-metadata.ts
const DYNAMIC_VARIABLE_MAP = {
	$CURRENT_USER: "directus_users",
	$CURRENT_ROLE: "directus_roles",
	$CURRENT_ROLES: "directus_roles",
	$CURRENT_POLICIES: "directus_policies"
};
/**
* Calculate logical expiry (TTL) and dependencies for permissions caching.
*/
function calculateCacheMetadata(collection, itemData, rawPermissions, schema, accountability) {
	let ttlMs;
	const dependencies = /* @__PURE__ */ new Set();
	if (itemData) {
		const now = Date.now();
		let closestExpiry = Infinity;
		const scan = (val, fieldKey, currentCollection = collection) => {
			if (!val || typeof val !== "object") return;
			for (const [key, value] of Object.entries(val)) {
				if (typeof value === "string" && value.startsWith("$")) if (value.startsWith("$NOW")) {
					const dateValue = itemData[fieldKey || key];
					if (dateValue) {
						let ruleDate = /* @__PURE__ */ new Date();
						if (value.includes("(")) {
							const adjustment = value.match(REGEX_BETWEEN_PARENS)?.[1];
							if (adjustment) ruleDate = adjustDate(ruleDate, adjustment) || ruleDate;
						}
						const adjustmentMs = ruleDate.getTime() - now;
						const expiry = new Date(dateValue).getTime() - adjustmentMs;
						if (expiry > now && expiry < closestExpiry) closestExpiry = expiry;
					}
				} else {
					const parts = value.split(".");
					const dynamicVariable = parts[0];
					const rootCollection = DYNAMIC_VARIABLE_MAP[dynamicVariable];
					if (rootCollection) {
						if (dynamicVariable === "$CURRENT_USER" && accountability.user) dependencies.add(`${rootCollection}:${accountability.user}`);
						else dependencies.add(rootCollection);
						if (parts.length > 1) {
							let currentCollection$1 = rootCollection;
							for (const segment of parts.slice(1, -1)) {
								if (!currentCollection$1) break;
								const relation = schema.relations.find((r) => r.collection === currentCollection$1 && r.field === segment || r.related_collection === currentCollection$1 && r.meta?.one_field === segment);
								if (relation) {
									currentCollection$1 = relation.collection === currentCollection$1 ? relation.related_collection : relation.collection;
									if (currentCollection$1) dependencies.add(currentCollection$1);
								} else currentCollection$1 = null;
							}
						}
					}
				}
				let field = key;
				if (key.includes("(") && key.includes(")")) {
					const columnName = key.match(REGEX_BETWEEN_PARENS)?.[1];
					if (columnName) field = columnName;
				}
				if (!field.startsWith("_")) {
					const relation = schema.relations.find((r) => r.collection === currentCollection && r.field === field || r.related_collection === currentCollection && r.meta?.one_field === field);
					let targetCol = null;
					if (relation) targetCol = relation.collection === currentCollection ? relation.related_collection : relation.collection;
					if (targetCol) {
						dependencies.add(targetCol);
						scan(value, void 0, targetCol);
					} else scan(value, field.startsWith("_") ? fieldKey : field, currentCollection);
				} else scan(value, fieldKey, currentCollection);
			}
		};
		for (const permission of rawPermissions) scan(permission.permissions);
		if (closestExpiry !== Infinity) {
			ttlMs = closestExpiry - now;
			ttlMs = Math.max(1e3, Math.min(ttlMs, 36e5));
		}
	}
	return {
		ttlMs,
		dependencies: Array.from(dependencies)
	};
}

//#endregion
export { DYNAMIC_VARIABLE_MAP, calculateCacheMetadata };