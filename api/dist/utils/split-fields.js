import { InvalidQueryError } from "@directus/errors";

//#region src/utils/split-fields.ts
/**
* Parenthesis aware splitting of fields allowing for `json(a, b)` field functions
*/
function splitFields(input) {
	const fields = [];
	let current = "";
	let depth = 0;
	for (const char of input) {
		if (char === "(") {
			depth++;
			if (depth > 1) throw new InvalidQueryError({ reason: "Nested functions are not supported in \"fields\"" });
		} else if (char === ")") depth--;
		if (char === "," && depth === 0) {
			fields.push(current);
			current = "";
		} else current += char;
	}
	if (depth !== 0) throw new InvalidQueryError({ reason: "Missing closing parenthesis in \"fields\"" });
	fields.push(current);
	return fields;
}

//#endregion
export { splitFields };