import { GENERATE_SPECIAL } from "../../../constants.js";
import { getGraphQLType } from "../../../utils/get-graphql-type.js";
import { SYSTEM_DENY_LIST } from "./index.js";
import { mapKeys, pick } from "lodash-es";
import { GraphQLID, GraphQLInt, GraphQLNonNull, GraphQLUnionType } from "graphql";
import { GraphQLJSON } from "graphql-compose";

//#region src/services/graphql/schema/get-types.ts
/**
* Construct an object of types for every collection, using the permitted fields per action type
* as it's fields.
*/
function getTypes(schemaComposer, scope, schema, inconsistentFields, action) {
	const CollectionTypes = {};
	const VersionTypes = {};
	const CountFunctions = schemaComposer.createObjectTC({
		name: "count_functions",
		fields: { count: { type: GraphQLInt } }
	});
	const DateFunctions = schemaComposer.createObjectTC({
		name: "date_functions",
		fields: {
			year: { type: GraphQLInt },
			month: { type: GraphQLInt },
			week: { type: GraphQLInt },
			day: { type: GraphQLInt },
			weekday: { type: GraphQLInt }
		}
	});
	const TimeFunctions = schemaComposer.createObjectTC({
		name: "time_functions",
		fields: {
			hour: { type: GraphQLInt },
			minute: { type: GraphQLInt },
			second: { type: GraphQLInt }
		}
	});
	const DateTimeFunctions = schemaComposer.createObjectTC({
		name: "datetime_functions",
		fields: {
			...DateFunctions.getFields(),
			...TimeFunctions.getFields()
		}
	});
	for (const collection of Object.values(schema[action].collections)) {
		if (Object.keys(collection.fields).length === 0) continue;
		if (SYSTEM_DENY_LIST.includes(collection.collection)) continue;
		CollectionTypes[collection.collection] = schemaComposer.createObjectTC({
			name: action === "read" ? collection.collection : `${action}_${collection.collection}`,
			fields: Object.values(collection.fields).reduce((acc, field) => {
				let type = getGraphQLType(field.type, field.special);
				const fieldIsInconsistent = inconsistentFields[action][collection.collection]?.includes(field.field);
				if (field.nullable === false && !field.defaultValue && !GENERATE_SPECIAL.some((flag) => field.special.includes(flag)) && fieldIsInconsistent === false && action !== "update") type = new GraphQLNonNull(type);
				if (collection.primary === field.field && fieldIsInconsistent === false) if (collection.collection === "directus_permissions") type = GraphQLID;
				else if (!field.defaultValue && !field.special.includes("uuid") && action === "create") type = new GraphQLNonNull(GraphQLID);
				else if (["create", "update"].includes(action)) type = GraphQLID;
				else type = new GraphQLNonNull(GraphQLID);
				acc[field.field] = {
					type,
					description: field.note,
					resolve: (obj) => {
						return obj[field.field];
					}
				};
				if (action === "read") {
					if (field.type === "date") acc[`${field.field}_func`] = {
						type: DateFunctions,
						resolve: (obj) => {
							return mapKeys(pick(obj, Object.keys(DateFunctions.getFields()).map((key) => `${field.field}_${key}`)), (_value, key) => key.substring(field.field.length + 1));
						}
					};
					if (field.type === "time") acc[`${field.field}_func`] = {
						type: TimeFunctions,
						resolve: (obj) => {
							return mapKeys(pick(obj, Object.keys(TimeFunctions.getFields()).map((key) => `${field.field}_${key}`)), (_value, key) => key.substring(field.field.length + 1));
						}
					};
					if (field.type === "dateTime" || field.type === "timestamp") acc[`${field.field}_func`] = {
						type: DateTimeFunctions,
						resolve: (obj) => {
							return mapKeys(pick(obj, Object.keys(DateTimeFunctions.getFields()).map((key) => `${field.field}_${key}`)), (_value, key) => key.substring(field.field.length + 1));
						}
					};
					if (field.type === "json" || field.type === "alias") acc[`${field.field}_func`] = {
						type: CountFunctions,
						resolve: (obj) => {
							return mapKeys(pick(obj, Object.keys(CountFunctions.getFields()).map((key) => `${field.field}_${key}`)), (_value, key) => key.substring(field.field.length + 1));
						}
					};
				}
				return acc;
			}, {})
		});
		if (scope === "items") VersionTypes[collection.collection] = CollectionTypes[collection.collection].clone(`version_${collection.collection}`);
	}
	for (const relation of schema[action].relations) if (relation.related_collection) {
		if (SYSTEM_DENY_LIST.includes(relation.related_collection)) continue;
		CollectionTypes[relation.collection]?.addFields({ [relation.field]: {
			type: CollectionTypes[relation.related_collection],
			resolve: (obj, _, __, info) => {
				return obj[info?.path?.key ?? relation.field];
			}
		} });
		VersionTypes[relation.collection]?.addFields({ [relation.field]: {
			type: GraphQLJSON,
			resolve: (obj, _, __, info) => {
				return obj[info?.path?.key ?? relation.field];
			}
		} });
		if (relation.meta?.one_field) {
			CollectionTypes[relation.related_collection]?.addFields({ [relation.meta.one_field]: {
				type: [CollectionTypes[relation.collection]],
				resolve: (obj, _, __, info) => {
					return obj[info?.path?.key ?? relation.meta.one_field];
				}
			} });
			if (scope === "items") VersionTypes[relation.related_collection]?.addFields({ [relation.meta.one_field]: {
				type: GraphQLJSON,
				resolve: (obj, _, __, info) => {
					return obj[info?.path?.key ?? relation.meta.one_field];
				}
			} });
		}
	} else if (relation.meta?.one_allowed_collections && action === "read") CollectionTypes[relation.collection]?.addFields({ [relation.field]: {
		type: new GraphQLUnionType({
			name: `${relation.collection}_${relation.field}_union`,
			types: relation.meta.one_allowed_collections.map((collection) => CollectionTypes[collection].getType()),
			resolveType(_value, context, info) {
				let path = [];
				let currentPath = info.path;
				while (currentPath.prev) {
					path.push(currentPath.key);
					currentPath = currentPath.prev;
				}
				path = path.reverse().slice(0, -1);
				let parent = context["data"];
				for (const pathPart of path) parent = parent[pathPart];
				return CollectionTypes[parent[relation.meta.one_collection_field]].getType().name;
			}
		}),
		resolve: (obj, _, __, info) => {
			return obj[info?.path?.key ?? relation.field];
		}
	} });
	return {
		CollectionTypes,
		VersionTypes
	};
}

//#endregion
export { getTypes };