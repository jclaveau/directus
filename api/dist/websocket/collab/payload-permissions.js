import { verifyPermissions } from "./verify-permissions.js";
import { ForbiddenError, InvalidPayloadError } from "@directus/errors";
import { deepMapWithSchema, isDetailedUpdateSyntax } from "@directus/utils";

//#region src/websocket/collab/payload-permissions.ts
/**
* Validates a changes payload against the user's update/create permissions and errors if unauthorized field is encountered
*/
async function validateChanges(payload, collection, itemId, context) {
	return processPermissions(payload, collection, {
		...context,
		itemId,
		direction: "inbound"
	});
}
/**
* Sanitizes a payload based on the recipient's read permissions and the schema
*/
async function sanitizePayload(payload, collection, context) {
	return processPermissions(payload, collection, {
		...context,
		direction: "outbound"
	});
}
/**
* Core utility to walk a payload and apply permissions
*/
async function processPermissions(payload, collection, context) {
	const { direction, accountability, schema, knex, itemId } = context;
	const permissionsCache = /* @__PURE__ */ new Map();
	const getPermissions = (col, id, action) => {
		const cacheKey = `${col}:${id}:${action}`;
		let cached = permissionsCache.get(cacheKey);
		if (!cached) {
			cached = verifyPermissions(accountability, col, id, action, {
				knex,
				schema
			});
			permissionsCache.set(cacheKey, cached);
		}
		return cached;
	};
	return deepMapWithSchema(payload, async (entry, deepMapContext) => {
		const [key, value] = entry;
		if (direction === "outbound") {
			if (deepMapContext.field?.special?.some((v) => v === "conceal" || v === "hash" || v === "encrypt")) return;
			if (deepMapContext.leaf && !deepMapContext.relation && !deepMapContext.field) return;
		}
		if (value === void 0) return void 0;
		const currentCollection = deepMapContext.collection.collection;
		const pkField = deepMapContext.collection.primary;
		const primaryKeyInObject = deepMapContext.object[pkField] ?? null;
		let action = direction === "inbound" ? "update" : "read";
		let effectiveItemId = primaryKeyInObject;
		if (direction === "inbound") {
			if (deepMapContext.object === payload) {
				effectiveItemId = itemId ?? null;
				action = itemId ? "update" : "create";
			} else if (!primaryKeyInObject) action = "create";
			if (deepMapContext.action) action = deepMapContext.action;
		} else if (deepMapContext.object === payload) effectiveItemId = primaryKeyInObject ?? itemId ?? null;
		if (direction === "inbound" && action === "delete") {
			if (key !== pkField) throw new InvalidPayloadError({ reason: `Unexpected field ${key} in delete payload` });
			const allowed = await getPermissions(currentCollection, primaryKeyInObject, "delete");
			if (allowed === null || allowed.length === 0 && !accountability?.admin) throw new ForbiddenError({ reason: `No permission to delete item in collection ${currentCollection}` });
			return;
		}
		if (direction === "inbound" && action === "update" && key === pkField) return;
		let allowedFields = await getPermissions(currentCollection, effectiveItemId, action);
		if (!allowedFields) {
			if (direction === "inbound" && action === "update") {
				action = "create";
				allowedFields = await getPermissions(currentCollection, effectiveItemId, action);
			} else if (direction === "outbound") allowedFields = await getPermissions(currentCollection, null, "read") ?? [];
		}
		if (!(allowedFields && (accountability?.admin || allowedFields.includes("*") || allowedFields.includes(String(key))))) {
			if (direction === "inbound") throw new ForbiddenError({ reason: `No permission to ${action} field ${key} or field does not exist` });
			return;
		}
		if (direction === "outbound" && deepMapContext.relationType) {
			if (Array.isArray(value)) {
				const items = value.filter(isVisible);
				if (items.length === 0) return void 0;
				return [key, items];
			} else if (isDetailedUpdateSyntax(value)) {
				const filtered = {
					...value,
					create: value.create.filter(isVisible),
					update: value.update.filter(isVisible),
					delete: value.delete.filter(isVisible)
				};
				if (filtered.create.length === 0 && filtered.update.length === 0 && filtered.delete.length === 0) return;
				return [key, filtered];
			} else if (!isVisible(value)) return;
		}
		return [key, value];
	}, {
		schema,
		collection
	}, {
		detailedUpdateSyntax: true,
		omitUnknownFields: direction === "outbound",
		mapPrimaryKeys: true,
		processAsync: true,
		iterateOnly: direction === "inbound",
		onUnknownField: (entry) => {
			const [key] = entry;
			if (String(key).startsWith("$")) return entry;
			if (direction === "inbound") throw new ForbiddenError({ reason: `No permission to update field ${key} or field does not exist` });
		}
	});
}
function isVisible(item) {
	return item !== void 0 && !(typeof item === "object" && item !== null && Object.keys(item).length === 0);
}

//#endregion
export { sanitizePayload, validateChanges };