import { fetchProvider } from "../lib/fetch-provider.js";

//#region src/ai/files/adapters/openai.ts
async function uploadToOpenAI(file, apiKey) {
	const formData = new FormData();
	formData.append("file", new Blob([new Uint8Array(file.data)], { type: file.mimeType }), file.filename);
	formData.append("purpose", "user_data");
	const result = await fetchProvider("https://api.openai.com/v1/files", {
		method: "POST",
		headers: { Authorization: `Bearer ${apiKey}` },
		body: formData
	}, "OpenAI");
	if (!result.id) throw new Error("OpenAI upload returned unexpected response");
	return {
		provider: "openai",
		fileId: result.id,
		filename: file.filename,
		mimeType: file.mimeType,
		sizeBytes: result.bytes ?? file.data.length,
		expiresAt: null
	};
}

//#endregion
export { uploadToOpenAI };