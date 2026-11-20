import { GraphQLScalarType, GraphQLString } from "graphql";

//#region src/services/graphql/types/hash.ts
const GraphQLHash = new GraphQLScalarType({
	...GraphQLString,
	name: "Hash",
	description: "Hashed string values"
});

//#endregion
export { GraphQLHash };