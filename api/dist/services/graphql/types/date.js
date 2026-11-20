import { GraphQLScalarType, GraphQLString } from "graphql";

//#region src/services/graphql/types/date.ts
const GraphQLDate = new GraphQLScalarType({
	...GraphQLString,
	name: "Date",
	description: "ISO8601 Date values"
});

//#endregion
export { GraphQLDate };