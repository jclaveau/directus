import { DEFAULT_AI_MODELS, buildCustomModels } from "@directus/ai";

//#region src/ai/providers/options.ts
function getModelDefinition(provider, model, settings) {
	const customModels = buildCustomModels(settings.openaiCompatibleModels);
	return [...DEFAULT_AI_MODELS, ...customModels].find((m) => m.provider === provider && m.model === model);
}
const OPENAI_REASONING_OPTIONS = { openai: {
	reasoningSummary: "auto",
	store: false,
	include: ["reasoning.encrypted_content"]
} };
function getProviderOptions(provider, model, settings) {
	const modelDef = getModelDefinition(provider, model, settings);
	if (provider === "openai" && modelDef?.reasoning) return OPENAI_REASONING_OPTIONS;
	if (provider === "openai-compatible") {
		const customModel = settings.openaiCompatibleModels?.find((m) => m.id === model);
		if (customModel?.providerOptions) return { [settings.openaiCompatibleName ?? "openai-compatible"]: customModel.providerOptions };
	}
	return {};
}

//#endregion
export { getModelDefinition, getProviderOptions };