import { FilesService } from "../../../services/files.js";
import { AssetsService } from "../../../services/assets.js";
import { requireText } from "../../../utils/require-text.js";
import { defineTool } from "../define-tool.js";
import { UnsupportedMediaTypeError } from "@directus/errors";
import { fileURLToPath } from "node:url";
import { z as z$1 } from "zod";
import { dirname, resolve } from "node:path";

//#region src/ai/tools/assets/index.ts
const __dirname = dirname(fileURLToPath(import.meta.url));
const AssetsValidateSchema = z$1.strictObject({ id: z$1.string() });
const AssetsInputSchema = z$1.object({ id: z$1.string() });
const assets = defineTool({
	name: "assets",
	description: requireText(resolve(__dirname, "./prompt.md")),
	annotations: { title: "Directus - Assets" },
	inputSchema: AssetsInputSchema,
	validateSchema: AssetsValidateSchema,
	async handler({ args, schema, accountability }) {
		const serviceOptions = {
			accountability,
			schema
		};
		const file = await new FilesService(serviceOptions).readOne(args.id, { limit: 1 });
		if (!file.type || !["image", "audio"].some((t) => file.type?.startsWith(t))) throw new UnsupportedMediaTypeError({
			mediaType: file.type ?? "unknown",
			where: "asset tool"
		});
		let transformation = void 0;
		if (file.type.startsWith("image") && file.width && file.height && (file.width > 1200 || file.height > 1200)) transformation = { transformationParams: { transforms: file.width > file.height ? [["resize", {
			width: 800,
			fit: "contain"
		}]] : [["resize", {
			height: 800,
			fit: "contain"
		}]] } };
		const asset = await new AssetsService(serviceOptions).getAsset(args.id, transformation);
		const chunks = [];
		for await (const chunk of asset.stream) chunks.push(Buffer.from(chunk));
		return {
			type: file.type.startsWith("image") ? "image" : "audio",
			data: Buffer.concat(chunks).toString("base64"),
			mimeType: file.type
		};
	}
});

//#endregion
export { assets };