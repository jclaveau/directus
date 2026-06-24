//#region src/ai/chat/utils/prompt-caching.ts
function buildCacheAwareSystemPrompt(provider, content) {
	if (provider !== "anthropic") return content;
	return {
		role: "system",
		content,
		providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } }
	};
}
/**
* For Anthropic, place a cache breakpoint on the last existing message so the conversation
* prefix (tools + system + history) caches as it grows, and append the per-request page
* context as a new user message after the breakpoint so it stays out of the cached prefix.
*
* Context is only appended after a real user turn. On multi-step continuations the last
* message is an assistant or tool result; appending a user message there would make the
* model respond to the context instead of synthesizing the tool output. The model still
* sees context from the originating user turn earlier in the conversation.
*
* Other providers either auto-cache (Google/OpenAI) or don't support this, so we keep the
* context inside the system prompt for them (handled upstream).
*/
function applyAnthropicConversationCaching(provider, messages, contextBlock) {
	if (provider !== "anthropic" || messages.length === 0) return messages;
	const lastIndex = messages.length - 1;
	const messagesWithCache = messages.map((message, index) => index === lastIndex ? {
		...message,
		providerOptions: {
			...message.providerOptions,
			anthropic: {
				...message.providerOptions?.["anthropic"],
				cacheControl: { type: "ephemeral" }
			}
		}
	} : message);
	if (!contextBlock || messages[lastIndex]?.role !== "user") return messagesWithCache;
	return [...messagesWithCache, {
		role: "user",
		content: contextBlock
	}];
}
function sortToolsByName(tools) {
	return Object.fromEntries(Object.entries(tools).sort(([a], [b]) => {
		if (a < b) return -1;
		if (a > b) return 1;
		return 0;
	}));
}
function formatUsageWithCacheTokens(result) {
	const usage = result.totalUsage ?? result.usage;
	const providerMetadata = result.steps?.map((step) => step.providerMetadata) ?? [result.providerMetadata];
	const { inputTokens, outputTokens, totalTokens } = usage;
	return {
		inputTokens,
		outputTokens,
		totalTokens,
		...getCacheTokenUsage(usage, providerMetadata)
	};
}
function getCacheTokenUsage(usage, providerMetadata) {
	const cacheReadTokens = usage.inputTokenDetails?.cacheReadTokens ?? usage.cachedInputTokens ?? sumNumbers([...providerMetadata.map((metadata) => getProviderMetadataNumber(metadata, "anthropic", "cacheReadInputTokens")), ...providerMetadata.map(getGoogleCachedContentTokenCount)]);
	const cacheCreationTokens = usage.inputTokenDetails?.cacheWriteTokens ?? sumNumbers(providerMetadata.map((metadata) => getProviderMetadataNumber(metadata, "anthropic", "cacheCreationInputTokens")));
	return {
		...cacheReadTokens !== void 0 ? { cacheReadTokens } : {},
		...cacheCreationTokens !== void 0 ? { cacheCreationTokens } : {}
	};
}
function getProviderMetadataNumber(providerMetadata, providerName, fieldName) {
	const value = providerMetadata?.[providerName]?.[fieldName];
	return typeof value === "number" ? value : void 0;
}
function getGoogleCachedContentTokenCount(providerMetadata) {
	const usageMetadata = providerMetadata?.["google"]?.["usageMetadata"];
	if (!usageMetadata || typeof usageMetadata !== "object" || Array.isArray(usageMetadata)) return;
	const cachedContentTokenCount = usageMetadata["cachedContentTokenCount"];
	return typeof cachedContentTokenCount === "number" ? cachedContentTokenCount : void 0;
}
function sumNumbers(values) {
	const definedValues = values.filter((value) => typeof value === "number");
	if (definedValues.length === 0) return;
	return definedValues.reduce((sum, value) => sum + value, 0);
}

//#endregion
export { applyAnthropicConversationCaching, buildCacheAwareSystemPrompt, formatUsageWithCacheTokens, sortToolsByName };