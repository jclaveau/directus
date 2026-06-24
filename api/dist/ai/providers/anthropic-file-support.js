import { useLogger } from "../../logger/index.js";
import { createAnthropic } from "@ai-sdk/anthropic";

//#region src/ai/providers/anthropic-file-support.ts
/**
* Creates an Anthropic provider with file_id support.
*
* The AI SDK's @ai-sdk/anthropic provider doesn't support Anthropic's Files API file_id.
* This wrapper intercepts the HTTP request and transforms base64 sources that contain
* a file_id marker into the native Anthropic file source format.
*
* When the AI SDK converts a FileUIPart with url=file_id, it creates a base64 source
* with the file_id as the data (since it's not a valid URL or base64). We detect this
* pattern and transform it to use the native file source type.
*/
function createAnthropicWithFileSupport(apiKey) {
	return createAnthropic({
		apiKey,
		fetch: async (url, options) => {
			if (!options?.body || typeof options.body !== "string") return fetch(url, options);
			try {
				const body = JSON.parse(options.body);
				if (!body.messages) return fetch(url, options);
				const { messages, hasFileIds } = transformMessagesForFileId(body.messages);
				body.messages = messages;
				const headersObj = {};
				if (options.headers instanceof Headers) options.headers.forEach((value, key) => {
					headersObj[key] = value;
				});
				else Object.assign(headersObj, options.headers);
				if (hasFileIds) {
					const existing = headersObj["anthropic-beta"];
					const betaFlag = "files-api-2025-04-14";
					if (!existing?.includes(betaFlag)) headersObj["anthropic-beta"] = existing ? `${existing},${betaFlag}` : betaFlag;
				}
				return fetch(url, {
					...options,
					headers: headersObj,
					body: JSON.stringify(body)
				});
			} catch (error) {
				useLogger().error("Anthropic file support: could not parse request body");
				throw error;
			}
		}
	});
}
/**
* Transforms messages to use file_id source type where applicable.
*
* The AI SDK converts FileUIPart.url to base64 source data. When url is a file_id
* (starts with "file_"), the data field contains the file_id string.
* We detect this and convert to native Anthropic file source format.
*/
function transformMessagesForFileId(messages) {
	let hasFileIds = false;
	return {
		messages: messages.map((msg) => {
			if (!msg.content || !Array.isArray(msg.content)) return msg;
			return {
				...msg,
				content: msg.content.map((block) => {
					if ((block.type === "image" || block.type === "document") && block.source?.type === "base64" && typeof block.source.data === "string" && block.source.data.startsWith("file_")) {
						const fileId = block.source.data;
						hasFileIds = true;
						return {
							...block,
							source: {
								type: "file",
								file_id: fileId
							}
						};
					}
					return block;
				})
			};
		}),
		hasFileIds
	};
}

//#endregion
export { createAnthropicWithFileSupport };