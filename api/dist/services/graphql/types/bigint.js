import { GraphQLScalarType, Kind } from "graphql";

//#region src/services/graphql/types/bigint.ts
const MIN_BIG_INT = -9223372036854775808n;
const MAX_BIG_INT = 9223372036854775807n;
const GraphQLBigInt = new GraphQLScalarType({
	name: "GraphQLBigInt",
	description: "BigInt value",
	serialize(value) {
		if (!value) return value;
		if (typeof value === "string") return value;
		if (typeof value !== "number") throw new Error("Value must be a Number");
		return value.toString();
	},
	parseValue(value) {
		if (typeof value !== "string") throw new Error("Value must be a String");
		return parseNumberValue(value);
	},
	parseLiteral(ast) {
		if (ast.kind !== Kind.STRING) throw new Error("Value must be a String");
		return parseNumberValue(ast.value);
	}
});
function parseNumberValue(input) {
	const intValue = Number(input);
	if (isNaN(intValue)) throw new Error("Invalid GraphQLBigInt");
	if (!Number.isSafeInteger(intValue)) {
		const bigIntInput = BigInt(input);
		if (bigIntInput < MIN_BIG_INT || bigIntInput > MAX_BIG_INT) throw new Error("Invalid GraphQLBigInt");
		return input;
	}
	return intValue;
}

//#endregion
export { GraphQLBigInt };