import { getDevToolsMiddleware } from "../../devtools/index.js";
import { buildProviderConfigs, createAIProviderRegistry } from "../../providers/registry.js";
import { getProviderOptions } from "../../providers/options.js";
import "../../providers/index.js";
import { getAITelemetryConfig } from "../../telemetry/index.js";
import { ObjectRequest } from "../models/object-request.js";
import { addAdditionalPropertiesToJsonSchema } from "../utils/add-additional-properties-to-json-schema.js";
import { ForbiddenError, InvalidPayloadError, ServiceUnavailableError } from "@directus/errors";
import { jsonSchema, streamObject, wrapLanguageModel } from "ai";
import { fromZodError } from "zod-validation-error";

//#region src/ai/chat/controllers/object.post.ts
const aiObjectPostHandler = async (req, res) => {
	if (!req.accountability?.app) throw new ForbiddenError();
	const parseResult = ObjectRequest.safeParse(req.body);
	if (!parseResult.success) throw new InvalidPayloadError({ reason: fromZodError(parseResult.error).message });
	const { provider, model, prompt, outputSchema, maxOutputTokens } = parseResult.data;
	const aiSettings = res.locals["ai"].settings;
	const allowedModelsMap = {
		openai: aiSettings.openaiAllowedModels,
		anthropic: aiSettings.anthropicAllowedModels,
		google: aiSettings.googleAllowedModels
	};
	if (provider !== "openai-compatible") {
		const allowedModels = allowedModelsMap[provider];
		if (!allowedModels || allowedModels.length === 0 || !allowedModels.includes(model)) throw new ForbiddenError({ reason: "Model not allowed for this provider" });
	}
	const configs = buildProviderConfigs(aiSettings);
	if (!configs.find((c) => c.type === provider)) throw new ServiceUnavailableError({
		service: provider,
		reason: "No API key configured for LLM provider"
	});
	const registry = createAIProviderRegistry(configs, aiSettings);
	const providerOptions = getProviderOptions(provider, model, aiSettings);
	let languageModel = registry.languageModel(`${provider}:${model}`);
	const devToolsMiddleware = getDevToolsMiddleware();
	if (devToolsMiddleware) languageModel = wrapLanguageModel({
		model: languageModel,
		middleware: devToolsMiddleware
	});
	const telemetryConfig = getAITelemetryConfig({
		provider,
		model,
		userId: req.accountability?.user,
		role: req.accountability?.role
	}, "directus-ai-object");
	streamObject({
		model: languageModel,
		prompt,
		schema: jsonSchema(addAdditionalPropertiesToJsonSchema(outputSchema)),
		providerOptions,
		...typeof maxOutputTokens === "number" ? { maxOutputTokens } : {},
		...telemetryConfig ? { experimental_telemetry: telemetryConfig } : {}
	}).pipeTextStreamToResponse(res);
};

//#endregion
export { aiObjectPostHandler };