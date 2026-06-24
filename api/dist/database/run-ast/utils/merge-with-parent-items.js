import { useEnv } from "@directus/env";
import { toArray } from "@directus/utils";
import { clone, isArray } from "lodash-es";

//#region src/database/run-ast/utils/merge-with-parent-items.ts
function mergeWithParentItems(schema, nestedItem, parentItem, nestedNode, fieldAllowed) {
	const env = useEnv();
	const nestedItems = toArray(nestedItem);
	const parentItems = clone(toArray(parentItem));
	if (nestedNode.type === "m2o") {
		const parentsByForeignKey = /* @__PURE__ */ new Map();
		const nestedPrimaryKeyField = schema.collections[nestedNode.relation.related_collection].primary;
		for (const parentItem$1 of parentItems) {
			const relationKey = parentItem$1[nestedNode.relation.field]?.[nestedPrimaryKeyField] ?? parentItem$1[nestedNode.relation.field];
			if (!parentsByForeignKey.has(relationKey)) parentsByForeignKey.set(relationKey, []);
			parentItem$1[nestedNode.fieldKey] = null;
			parentsByForeignKey.get(relationKey).push(parentItem$1);
		}
		for (const nestedItem$1 of nestedItems) {
			const nestedPK = nestedItem$1[nestedPrimaryKeyField];
			if (nestedPK === null) continue;
			if (!parentsByForeignKey.has(nestedPK)) continue;
			for (const parentItem$1 of parentsByForeignKey.get(nestedPK)) parentItem$1[nestedNode.fieldKey] = nestedItem$1;
		}
	} else if (nestedNode.type === "o2m") {
		const parentCollectionName = nestedNode.relation.related_collection;
		const parentPrimaryKeyField = schema.collections[parentCollectionName].primary;
		const parentRelationField = nestedNode.fieldKey;
		const nestedParentKeyField = nestedNode.relation.field;
		const parentsByPrimaryKey = /* @__PURE__ */ new Map();
		for (const parentItem$1 of parentItems) {
			if (!parentItem$1[parentRelationField]) parentItem$1[parentRelationField] = [];
			let parentPrimaryKey = parentItem$1[parentPrimaryKeyField];
			if (parentPrimaryKey === null) continue;
			else parentPrimaryKey = parentPrimaryKey.toString();
			if (parentsByPrimaryKey.has(parentPrimaryKey)) throw new Error(`Duplicate parent primary key '${parentPrimaryKey}' of '${parentCollectionName}' when merging o2m nested items`);
			parentsByPrimaryKey.set(parentPrimaryKey, parentItem$1);
		}
		const toAddToAllParents = [];
		for (const nestedItem$1 of nestedItems) {
			if (nestedItem$1 === null) continue;
			if (Array.isArray(nestedItem$1[nestedParentKeyField])) {
				toAddToAllParents.push(nestedItem$1);
				continue;
			}
			const parentPrimaryKey = nestedItem$1[nestedParentKeyField]?.[parentPrimaryKeyField] ?? nestedItem$1[nestedParentKeyField];
			if (parentPrimaryKey === null) continue;
			const parentItem$1 = parentsByPrimaryKey.get(parentPrimaryKey.toString());
			if (!parentItem$1) continue;
			parentItem$1[parentRelationField].push(nestedItem$1);
		}
		for (const [index, parentItem$1] of parentItems.entries()) {
			if (fieldAllowed === false || isArray(fieldAllowed) && !fieldAllowed[index]) {
				parentItem$1[nestedNode.fieldKey] = null;
				continue;
			}
			parentItem$1[parentRelationField].push(...toAddToAllParents);
			const limit = nestedNode.query.limit ?? Number(env["QUERY_LIMIT_DEFAULT"]);
			if (nestedNode.query.page && nestedNode.query.page > 1) parentItem$1[nestedNode.fieldKey] = parentItem$1[nestedNode.fieldKey].slice(limit * (nestedNode.query.page - 1));
			if (nestedNode.query.offset && nestedNode.query.offset >= 0) parentItem$1[nestedNode.fieldKey] = parentItem$1[nestedNode.fieldKey].slice(nestedNode.query.offset);
			if (limit !== -1) parentItem$1[nestedNode.fieldKey] = parentItem$1[nestedNode.fieldKey].slice(0, limit);
			parentItem$1[nestedNode.fieldKey] = parentItem$1[nestedNode.fieldKey].sort((a, b) => {
				const sortField = nestedNode.query.sort[0];
				let column = sortField;
				let order = "asc";
				if (sortField.startsWith("-")) {
					column = sortField.substring(1);
					order = "desc";
				}
				if (a[column] === b[column]) return 0;
				if (a[column] === null) return 1;
				if (b[column] === null) return -1;
				if (order === "asc") return a[column] < b[column] ? -1 : 1;
				else return a[column] < b[column] ? 1 : -1;
			});
		}
	} else if (nestedNode.type === "a2o") for (const parentItem$1 of parentItems) {
		if (!nestedNode.relation.meta?.one_collection_field) {
			parentItem$1[nestedNode.fieldKey] = null;
			continue;
		}
		const relatedCollection = parentItem$1[nestedNode.relation.meta.one_collection_field];
		if (!nestedItem[relatedCollection]) {
			parentItem$1[nestedNode.fieldKey] = null;
			continue;
		}
		const relatedPrimaryKeyField = schema.collections[relatedCollection].primary;
		const foreignKey = parentItem$1[nestedNode.relation.field]?.[relatedPrimaryKeyField] ?? parentItem$1[nestedNode.relation.field];
		const itemChild = nestedItem[relatedCollection].find((nestedItem$1) => {
			return nestedItem$1[nestedNode.relatedKey[relatedCollection]] == foreignKey;
		});
		parentItem$1[nestedNode.fieldKey] = itemChild || null;
	}
	return Array.isArray(parentItem) ? parentItems : parentItems[0];
}

//#endregion
export { mergeWithParentItems };