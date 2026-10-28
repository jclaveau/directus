import { GraphQLScalarType } from "graphql";

//#region src/services/graphql/types/void.ts
const GraphQLVoid = new GraphQLScalarType({
	name: "Void",
	description: "Represents NULL values",
	serialize() {
		return null;
	},
	parseValue() {
		return null;
	},
	parseLiteral() {
		return null;
	}
});

//#endregion
export { GraphQLVoid };