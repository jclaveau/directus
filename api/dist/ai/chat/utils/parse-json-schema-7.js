import { fromZodError } from "zod-validation-error";
import { z as z$1 } from "zod";

//#region src/ai/chat/utils/parse-json-schema-7.ts
const jsonType = z$1.enum([
	"null",
	"boolean",
	"object",
	"array",
	"number",
	"integer",
	"string"
]);
const maybeDraft7Url = z$1.url({
	protocol: /^https?$/,
	hostname: /^json-schema\.org$/
}).refine((val) => {
	try {
		const u = new URL(val);
		return u.pathname === "/draft-07/schema" && (u.hash === "" || u.hash === "#");
	} catch {
		return false;
	}
}, { message: "Must be the JSON Schema Draft-07 meta-schema URL" });
const JsonSchema7 = z$1.object({
	$schema: maybeDraft7Url.optional(),
	$id: z$1.string().optional(),
	$ref: z$1.string().optional(),
	title: z$1.string().optional(),
	description: z$1.string().optional(),
	type: z$1.union([jsonType, z$1.array(jsonType).nonempty()]).optional(),
	properties: z$1.record(z$1.string(), z$1.any()).optional(),
	required: z$1.array(z$1.string()).optional(),
	items: z$1.union([z$1.any(), z$1.array(z$1.any()).nonempty()]).optional(),
	additionalProperties: z$1.union([z$1.boolean(), z$1.any()]).optional(),
	patternProperties: z$1.record(z$1.string(), z$1.any()).optional(),
	enum: z$1.array(z$1.any()).optional(),
	const: z$1.any().optional(),
	anyOf: z$1.array(z$1.any()).optional(),
	allOf: z$1.array(z$1.any()).optional(),
	oneOf: z$1.array(z$1.any()).optional(),
	not: z$1.any().optional(),
	definitions: z$1.record(z$1.string(), z$1.any()).optional(),
	$defs: z$1.record(z$1.string(), z$1.any()).optional()
}).refine((obj) => {
	const keys = new Set(Object.keys(obj));
	return [
		"type",
		"properties",
		"items",
		"required",
		"enum",
		"const",
		"anyOf",
		"allOf",
		"oneOf",
		"not",
		"$ref",
		"additionalProperties",
		"patternProperties",
		"definitions",
		"$defs"
	].some((k) => keys.has(k));
}, { message: "No schema keywords found" });
/**
* Checks whether an input object is *likely* a JSON Schema 7 object
* Limitations:
* - Does NOT validate nested schemas (e.g., inside `properties`, `items`, `definitions`, etc.)
* - Does NOT check for correct usage of combinators (`anyOf`, `allOf`, `oneOf`, `not`)
* - Does NOT verify required/optional keyword relationships (e.g., `required` only valid for object type)
* - Does NOT validate formats, patterns, or constraints (e.g., `pattern`, `minimum`, `maximum`, etc.)
* - Accepts both `definitions` and `$defs` for tolerance, but does not enforce draft-07 strictness
* - Only checks for presence of top-level schema keywords
* This is not a perfect validator, and does not check nested properties or full JSON Schema 7 compliance
*/
const parseJsonSchema7 = (schema) => {
	const { success, error, data } = JsonSchema7.safeParse(schema);
	if (!success) throw new Error(`Invalid JSON Schema passed: ${fromZodError(error).message}`);
	return data;
};

//#endregion
export { parseJsonSchema7 };