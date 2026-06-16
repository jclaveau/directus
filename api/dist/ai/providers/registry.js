import { createAnthropicWithFileSupport } from "./anthropic-file-support.js";
import { createProviderRegistry } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

//#region src/ai/providers/registry.ts
function buildProviderConfigs(settings) {
	const configs = [];
	if (settings.openaiApiKey) configs.push({
		type: "openai",
		apiKey: settings.openaiApiKey
	});
	if (settings.anthropicApiKey) configs.push({
		type: "anthropic",
		apiKey: settings.anthropicApiKey
	});
	if (settings.googleApiKey) configs.push({
		type: "google",
		apiKey: settings.googleApiKey
	});
	if (settings.openaiCompatibleApiKey && settings.openaiCompatibleBaseUrl) configs.push({
		type: "openai-compatible",
		apiKey: settings.openaiCompatibleApiKey,
		baseUrl: settings.openaiCompatibleBaseUrl
	});
	return configs;
}
function createAIProviderRegistry(configs, settings) {
	const providers = {};
	for (const config of configs) switch (config.type) {
		case "openai":
			providers["openai"] = createOpenAI({ apiKey: config.apiKey });
			break;
		case "anthropic":
			providers["anthropic"] = createAnthropicWithFileSupport(config.apiKey);
			break;
		case "google":
			providers["google"] = createGoogleGenerativeAI({ apiKey: config.apiKey });
			break;
		case "openai-compatible":
			if (config.baseUrl) {
				const customHeaders = Object.fromEntries(settings?.openaiCompatibleHeaders?.map(({ header, value }) => [header, value]) ?? []);
				providers["openai-compatible"] = createOpenAICompatible({
					name: settings?.openaiCompatibleName ?? "openai-compatible",
					apiKey: config.apiKey,
					baseURL: config.baseUrl,
					headers: customHeaders
				});
			}
			break;
	}
	return createProviderRegistry(providers);
}

//#endregion
export { buildProviderConfigs, createAIProviderRegistry };