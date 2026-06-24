import { uploadToOpenAI } from "../adapters/openai.js";
import { uploadToAnthropic } from "../adapters/anthropic.js";
import { uploadToGoogle } from "../adapters/google.js";
import { InvalidPayloadError } from "@directus/errors";

//#region src/ai/files/lib/upload-to-provider.ts
async function uploadToProvider(file, provider, settings) {
	switch (provider) {
		case "openai":
			if (!settings.openaiApiKey) throw new InvalidPayloadError({ reason: "OpenAI API key not configured" });
			return uploadToOpenAI(file, settings.openaiApiKey);
		case "anthropic":
			if (!settings.anthropicApiKey) throw new InvalidPayloadError({ reason: "Anthropic API key not configured" });
			return uploadToAnthropic(file, settings.anthropicApiKey);
		case "google":
			if (!settings.googleApiKey) throw new InvalidPayloadError({ reason: "Google API key not configured" });
			return uploadToGoogle(file, settings.googleApiKey);
		default: throw new InvalidPayloadError({ reason: `Provider ${provider} does not support file uploads` });
	}
}

//#endregion
export { uploadToProvider };