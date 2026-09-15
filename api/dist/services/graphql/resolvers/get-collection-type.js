import { getGraphQLType } from "../../../utils/get-graphql-type.js";
import { GraphQLNonNull, GraphQLString } from "graphql";

//#region src/services/graphql/resolvers/get-collection-type.ts
function getCollectionType(schemaComposer, schema, action) {
	const prefix = action === "read" ? "" : "write_";
	const Collection = schemaComposer.createObjectTC({ name: `${prefix}directus_collections` });
	if ("directus_collections" in schema.read.collections === false) return Collection;
	Collection.addFields({
		collection: GraphQLString,
		meta: schemaComposer.createObjectTC({
			name: `${prefix}directus_collections_meta`,
			fields: Object.values(schema.read.collections["directus_collections"].fields).reduce((acc, field) => {
				acc[field.field] = {
					type: field.nullable || action === "write" ? getGraphQLType(field.type, field.special) : new GraphQLNonNull(getGraphQLType(field.type, field.special)),
					description: field.note
				};
				return acc;
			}, {})
		}),
		schema: schemaComposer.createObjectTC({
			name: `${prefix}directus_collections_schema`,
			fields: {
				name: GraphQLString,
				comment: GraphQLString
			}
		})
	});
	return Collection;
}

//#endregion
export { getCollectionType };