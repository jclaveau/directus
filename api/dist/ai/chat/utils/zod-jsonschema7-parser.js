import { parseJsonSchema7 } from "./parse-json-schema-7.js";
import "ai";

//#region src/ai/chat/utils/zod-jsonschema7-parser.ts
const zodJsonSchema7Parser = (schema) => {
	try {
		parseJsonSchema7(schema);
		return true;
	} catch (error) {
		if (error instanceof Error && error.message.startsWith("Invalid JSON Schema")) return false;
		throw error;
	}
};

//#endregion
export { zodJsonSchema7Parser };