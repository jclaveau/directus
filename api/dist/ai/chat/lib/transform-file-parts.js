import { useLogger } from "../../../logger/index.js";

//#region src/ai/chat/lib/transform-file-parts.ts
function isFileUIPart(part) {
	return typeof part === "object" && part !== null && part.type === "file";
}
/**
* Transforms UIMessage file parts to use provider file_id instead of display URL.
*
* The frontend sends files with:
* - url: display URL for UI rendering (blob: or /assets/ URL)
* - providerMetadata.directus.fileId: the actual provider file ID
*
* This function replaces the url with the fileId so the AI SDK can use it
* with the provider's native file handling.
*/
function transformFilePartsForProvider(messages) {
	const logger = useLogger();
	return messages.map((msg) => {
		if (!Array.isArray(msg.parts)) return msg;
		const parts = [];
		for (const part of msg.parts) {
			if (!isFileUIPart(part)) {
				parts.push(part);
				continue;
			}
			const fileId = part.providerMetadata?.directus?.fileId;
			if (!fileId) {
				logger.warn("File part missing providerMetadata.directus.fileId, filtering out");
				continue;
			}
			parts.push({
				...part,
				url: fileId
			});
		}
		return {
			...msg,
			parts
		};
	});
}

//#endregion
export { transformFilePartsForProvider };