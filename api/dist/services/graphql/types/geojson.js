import { GraphQLScalarType } from "graphql";
import { GraphQLJSON } from "graphql-compose";

//#region src/services/graphql/types/geojson.ts
const GraphQLGeoJSON = new GraphQLScalarType({
	...GraphQLJSON,
	name: "GraphQLGeoJSON",
	description: "GeoJSON value"
});

//#endregion
export { GraphQLGeoJSON };