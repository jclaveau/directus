import { anthropic } from "@ai-sdk/anthropic";

//#region src/ai/providers/anthropic-tool-search.ts
/**
* For supported Anthropic models, enables tool search to reduce token usage.
* All tools are marked as deferred so they're only loaded when Claude needs them.
* Tool search is not supported on Haiku models.
*/
function applyAnthropicToolSearch(provider, model, tools) {
	if (provider !== "anthropic" || model.includes("haiku") || Object.keys(tools).length === 0) return tools;
	const deferredTools = {};
	for (const [name, t] of Object.entries(tools)) deferredTools[name] = {
		...t,
		providerOptions: {
			...t.providerOptions,
			anthropic: {
				...t.providerOptions?.["anthropic"],
				deferLoading: true
			}
		}
	};
	return {
		...deferredTools,
		toolSearch: anthropic.tools.toolSearchBm25_20251119()
	};
}

//#endregion
export { applyAnthropicToolSearch };