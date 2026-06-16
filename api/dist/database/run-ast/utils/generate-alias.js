import { getSimpleHash } from "@directus/utils";
import { customAlphabet } from "nanoid/non-secure";

//#region src/database/run-ast/utils/generate-alias.ts
const generateRandomAlias = customAlphabet("abcdefghijklmnopqrstuvwxyz", 5);
function generateAlias(context = "") {
	if (context) return generateDeterministicAlias(context);
	return generateRandomAlias();
}
function generateQueryAlias(table, query, path = "") {
	return generateDeterministicAlias(JSON.stringify({
		table,
		path,
		sort: query.sort,
		group: query.group,
		aggregate: query.aggregate
	}));
}
function generateRelationalQueryAlias(table, column, collectionName, options) {
	return generateDeterministicAlias(JSON.stringify({
		table,
		column,
		collectionName,
		filter: options?.relationalCountOptions?.query?.filter
	}));
}
function generateJoinAlias(collection, path, relationType, parentFields = "") {
	return generateDeterministicAlias(JSON.stringify({
		collection,
		path: path.join("."),
		relationType,
		parentFields
	}));
}
function generateDeterministicAlias(context = "") {
	const hash = getSimpleHash(context);
	const alphabet = "abcdefghijklmnopqrstuvwxyz";
	let result = "";
	let num = parseInt(hash, 16);
	for (let i = 0; i < 5; i++) {
		result += alphabet[num % 26];
		num = Math.floor(num / 26);
	}
	return result;
}

//#endregion
export { generateAlias, generateJoinAlias, generateQueryAlias, generateRelationalQueryAlias };