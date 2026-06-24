import { useLogger } from "../../../logger/index.js";
import { uploadToProvider } from "../lib/upload-to-provider.js";
import { ForbiddenError, InvalidPayloadError } from "@directus/errors";
import { AI_ALLOWED_MIME_TYPES } from "@directus/ai";
import Busboy from "busboy";

//#region src/ai/files/controllers/upload.ts
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(AI_ALLOWED_MIME_TYPES);
const SUPPORTED_PROVIDERS = new Set([
	"openai",
	"anthropic",
	"google"
]);
function isSupportedProvider(provider) {
	return SUPPORTED_PROVIDERS.has(provider);
}
async function parseMultipart(headers, stream) {
	const contentType = headers["content-type"];
	if (!contentType || !contentType.toLowerCase().startsWith("multipart/")) throw new InvalidPayloadError({ reason: "Expected multipart/form-data content type" });
	return new Promise((resolve, reject) => {
		let file;
		let provider;
		let settled = false;
		const safeReject = (error) => {
			if (settled) return;
			settled = true;
			reject(error);
		};
		const bb = Busboy({
			headers,
			limits: {
				fileSize: MAX_FILE_SIZE,
				files: 1
			}
		});
		bb.on("file", (_name, fileStream, info) => {
			const chunks = [];
			let exceeded = false;
			fileStream.on("data", (chunk) => chunks.push(chunk));
			fileStream.on("limit", () => {
				exceeded = true;
				fileStream.destroy();
				safeReject(new InvalidPayloadError({ reason: `File exceeds maximum size of ${MAX_FILE_SIZE / (1024 * 1024)}MB` }));
			});
			fileStream.on("close", () => {
				if (exceeded) return;
				file = {
					filename: info.filename || "file",
					mimeType: info.mimeType,
					data: Buffer.concat(chunks)
				};
			});
			fileStream.on("error", safeReject);
		});
		bb.on("field", (name, value) => {
			if (name === "provider") provider = value;
		});
		bb.on("close", () => {
			if (settled) return;
			settled = true;
			resolve({
				file,
				provider
			});
		});
		bb.on("error", safeReject);
		stream.pipe(bb);
	});
}
const aiFileUploadHandler = async (req, res, next) => {
	const logger = useLogger();
	try {
		if (!req.accountability?.app) throw new ForbiddenError();
		const aiSettings = res.locals["ai"]?.settings;
		if (!aiSettings) throw new InvalidPayloadError({ reason: "AI settings not loaded" });
		const { file, provider } = await parseMultipart(req.headers, req);
		if (!file) throw new InvalidPayloadError({ reason: "No file provided" });
		if (!provider) throw new InvalidPayloadError({ reason: "No provider specified" });
		if (!isSupportedProvider(provider)) throw new InvalidPayloadError({ reason: provider === "openai-compatible" ? "File uploads not supported for openai-compatible provider" : `Unsupported provider: ${provider}` });
		if (!ALLOWED_MIME_TYPES.has(file.mimeType)) throw new InvalidPayloadError({ reason: `Unsupported file type: ${file.mimeType}` });
		const result = await uploadToProvider(file, provider, aiSettings);
		res.json(result);
	} catch (error) {
		if (error instanceof Error && !(error instanceof ForbiddenError) && !(error instanceof InvalidPayloadError)) logger.error(error, "AI file upload failed");
		next(error);
	}
};

//#endregion
export { aiFileUploadHandler };