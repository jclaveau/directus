import { zodJsonSchema7Parser } from "../utils/zod-jsonschema7-parser.js";
import { ProviderAnthropic, ProviderGoogle, ProviderOpenAi, ProviderOpenAiCompatible } from "./providers.js";
import "ai";
import { z as z$1 } from "zod";

//#region src/ai/chat/models/object-request.ts
const ObjectRequest = z$1.intersection(z$1.discriminatedUnion("provider", [
	ProviderOpenAi,
	ProviderAnthropic,
	ProviderGoogle,
	ProviderOpenAiCompatible
]), z$1.object({
	prompt: z$1.string(),
	outputSchema: z$1.custom(zodJsonSchema7Parser, { message: "Invalid JSON schema" }),
	maxOutputTokens: z$1.number().int().min(256).optional()
}));

//#endregion
export { ObjectRequest };