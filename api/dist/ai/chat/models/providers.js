import { z as z$1 } from "zod";

//#region src/ai/chat/models/providers.ts
const ProviderTypeSchema = z$1.enum([
	"openai",
	"anthropic",
	"google",
	"openai-compatible"
]);
const ProviderOpenAi = z$1.object({
	provider: z$1.literal("openai"),
	model: z$1.string()
});
const ProviderAnthropic = z$1.object({
	provider: z$1.literal("anthropic"),
	model: z$1.string()
});
const ProviderGoogle = z$1.object({
	provider: z$1.literal("google"),
	model: z$1.string()
});
const ProviderOpenAiCompatible = z$1.object({
	provider: z$1.literal("openai-compatible"),
	model: z$1.string()
});

//#endregion
export { ProviderAnthropic, ProviderGoogle, ProviderOpenAi, ProviderOpenAiCompatible, ProviderTypeSchema };