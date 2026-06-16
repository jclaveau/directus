//#region src/ai/chat/utils/add-additional-properties-to-json-schema.ts
/**
* Recursively sets `additionalProperties: false` on all object-type nodes.
* OpenAI and Anthropic require this for structured output schemas.
* Mirrors the SDK's internal `addAdditionalPropertiesToJsonSchema` which is not exported.
*/
function addAdditionalPropertiesToJsonSchema(input) {
	return visit(structuredClone(input));
}
function visit(schema) {
	if (schema.type === "object" || Array.isArray(schema.type) && schema.type.includes("object")) schema.additionalProperties = false;
	if (schema.properties) for (const key of Object.keys(schema.properties)) {
		const val = schema.properties[key];
		if (typeof val === "object" && val !== null) schema.properties[key] = visit(val);
	}
	if (schema.items) {
		if (Array.isArray(schema.items)) schema.items = schema.items.map((item) => typeof item === "object" && item !== null ? visit(item) : item);
		else if (typeof schema.items === "object") schema.items = visit(schema.items);
	}
	for (const key of [
		"anyOf",
		"allOf",
		"oneOf"
	]) if (Array.isArray(schema[key])) schema[key] = schema[key].map((s) => typeof s === "object" && s !== null ? visit(s) : s);
	if (schema.definitions) for (const key of Object.keys(schema.definitions)) {
		const val = schema.definitions[key];
		if (typeof val === "object" && val !== null) schema.definitions[key] = visit(val);
	}
	if (schema["$defs"]) for (const key of Object.keys(schema["$defs"])) {
		const val = schema["$defs"][key];
		if (typeof val === "object" && val !== null) schema["$defs"][key] = visit(val);
	}
	return schema;
}

//#endregion
export { addAdditionalPropertiesToJsonSchema };