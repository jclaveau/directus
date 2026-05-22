import { getRelationType } from "../../../utils/get-relation-type.js";
import { fetchPolicies } from "../../../permissions/lib/fetch-policies.js";
import { fetchPermissions } from "../../../permissions/lib/fetch-permissions.js";
import { getAllowedSort } from "../utils/get-allowed-sort.js";
import { getDeepQuery } from "../utils/get-deep-query.js";
import { getRelatedCollection } from "../utils/get-related-collection.js";
import { convertWildcards } from "./convert-wildcards.js";
import { isEmpty } from "lodash-es";
import { getRelation } from "@directus/utils";
import { REGEX_BETWEEN_PARENS } from "@directus/constants";

//#region src/database/get-ast-from-query/lib/parse-fields.ts
async function parseFields(options, context) {
	let { fields } = options;
	if (!fields) return [];
	fields = await convertWildcards({
		fields,
		collection: options.parentCollection,
		alias: options.query.alias,
		accountability: options.accountability,
		backlink: options.query.backlink
	}, context);
	if (!fields || !Array.isArray(fields)) return [];
	const children = [];
	const policies = options.accountability && options.accountability.admin === false ? await fetchPolicies(options.accountability, context) : null;
	const relationalStructure = Object.create(null);
	for (const fieldKey of fields) {
		let name = fieldKey;
		if (options.query.alias) {
			if (name in options.query.alias) name = options.query.alias[fieldKey];
		}
		if (name.includes(".") || !!context.schema.relations.find((relation) => relation.related_collection === options.parentCollection && relation.meta?.one_field === name)) {
			const parts = fieldKey.split(".");
			let rootField = parts[0];
			let collectionScope = null;
			if (rootField.includes(":")) {
				const [key, scope] = rootField.split(":");
				rootField = key;
				collectionScope = scope;
			}
			if (rootField in relationalStructure === false) if (collectionScope) relationalStructure[rootField] = { [collectionScope]: [] };
			else relationalStructure[rootField] = [];
			if (parts.length > 1) {
				const childKey = parts.slice(1).join(".");
				if (collectionScope) {
					if (collectionScope in relationalStructure[rootField] === false) relationalStructure[rootField][collectionScope] = [];
					relationalStructure[rootField][collectionScope].push(childKey);
				} else relationalStructure[rootField].push(childKey);
			}
		} else {
			if (name.includes("(") && name.includes(")")) {
				const columnName = name.match(REGEX_BETWEEN_PARENS)[1];
				const foundField = context.schema.collections[options.parentCollection].fields[columnName];
				if (foundField && foundField.type === "alias") {
					const foundRelation = context.schema.relations.find((relation) => relation.related_collection === options.parentCollection && relation.meta?.one_field === columnName);
					if (foundRelation) {
						children.push({
							type: "functionField",
							name,
							fieldKey,
							query: {},
							relatedCollection: foundRelation.collection,
							whenCase: [],
							cases: []
						});
						continue;
					}
				}
			}
			if (name.includes(":")) {
				const [key, scope] = name.split(":");
				if (key in relationalStructure === false) relationalStructure[key] = { [scope]: [] };
				else if (scope in relationalStructure[key] === false) relationalStructure[key][scope] = [];
				continue;
			}
			children.push({
				type: "field",
				name,
				fieldKey,
				whenCase: []
			});
		}
	}
	for (const [fieldKey, nestedFields] of Object.entries(relationalStructure)) {
		let fieldName = fieldKey;
		if (options.query.alias && fieldKey in options.query.alias) fieldName = options.query.alias[fieldKey];
		const relatedCollection = getRelatedCollection(context.schema, options.parentCollection, fieldName);
		const relation = getRelation(context.schema.relations, options.parentCollection, fieldName);
		if (!relation) continue;
		const relationType = getRelationType({
			relation,
			collection: options.parentCollection,
			field: fieldName
		});
		if (!relationType) continue;
		let child = null;
		if (relationType === "a2o") {
			let allowedCollections = relation.meta.one_allowed_collections;
			if (options.accountability && options.accountability.admin === false && policies) {
				const permissions = await fetchPermissions({
					action: "read",
					collections: allowedCollections,
					policies,
					accountability: options.accountability
				}, context);
				allowedCollections = allowedCollections.filter((collection) => permissions.some((permission) => permission.collection === collection));
			}
			child = {
				type: "a2o",
				names: allowedCollections,
				children: {},
				query: {},
				relatedKey: {},
				parentKey: context.schema.collections[options.parentCollection].primary,
				fieldKey,
				relation,
				cases: {},
				whenCase: []
			};
			for (const relatedCollection$1 of allowedCollections) {
				child.children[relatedCollection$1] = await parseFields({
					parentCollection: relatedCollection$1,
					fields: Array.isArray(nestedFields) ? nestedFields : nestedFields[relatedCollection$1] || [],
					query: options.query,
					deep: options.deep?.[`${fieldKey}:${relatedCollection$1}`],
					accountability: options.accountability
				}, {
					...context,
					parentRelation: relation
				});
				child.query[relatedCollection$1] = getDeepQuery(options.deep?.[`${fieldKey}:${relatedCollection$1}`] || {});
				child.relatedKey[relatedCollection$1] = context.schema.collections[relatedCollection$1].primary;
			}
		} else if (relatedCollection) {
			if (options.accountability && options.accountability.admin === false && policies) {
				if ((await fetchPermissions({
					action: "read",
					collections: [relatedCollection],
					policies,
					accountability: options.accountability
				}, context)).length === 0) continue;
			}
			const childQuery = { ...options.query };
			const deepAlias = getDeepQuery(options.deep?.[fieldKey] || {})?.["alias"];
			childQuery.alias = isEmpty(deepAlias) ? {} : deepAlias;
			child = {
				type: relationType,
				name: relatedCollection,
				fieldKey,
				parentKey: context.schema.collections[options.parentCollection].primary,
				relatedKey: context.schema.collections[relatedCollection].primary,
				relation,
				query: getDeepQuery(options.deep?.[fieldKey] || {}),
				children: await parseFields({
					parentCollection: relatedCollection,
					fields: nestedFields,
					query: childQuery,
					deep: options.deep?.[fieldKey] || {},
					accountability: options.accountability
				}, {
					...context,
					parentRelation: relation
				}),
				cases: [],
				whenCase: []
			};
			if (isO2MNode(child) && !child.query.sort) child.query.sort = await getAllowedSort({
				collection: relation.collection,
				relation,
				accountability: options.accountability
			}, context);
			if (isO2MNode(child) && child.query.group && child.query.group[0] !== relation.field) child.query.group.unshift(relation.field);
		}
		if (child) children.push(child);
	}
	const nestedCollectionNodes = children.filter((childNode) => childNode.type !== "field");
	return children.filter((childNode) => {
		const existsAsNestedRelational = !!nestedCollectionNodes.find((nestedCollectionNode) => childNode.fieldKey === nestedCollectionNode.fieldKey);
		if (childNode.type === "field" && existsAsNestedRelational) return false;
		return true;
	});
}
function isO2MNode(node) {
	return !!node && node.type === "o2m";
}

//#endregion
export { isO2MNode, parseFields };