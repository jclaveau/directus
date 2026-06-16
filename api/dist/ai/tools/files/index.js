import { FilesService } from "../../../services/files.js";
import { requireText } from "../../../utils/require-text.js";
import { defineTool } from "../define-tool.js";
import { FileImportItemInputSchema, FileImportItemValidateSchema, FileItemInputSchema, FileItemValidateSchema, PrimaryKeyInputSchema, PrimaryKeyValidateSchema, QueryInputSchema, QueryValidateSchema } from "../schema.js";
import { buildSanitizedQueryFromArgs } from "../utils.js";
import { isObject } from "@directus/utils";
import { fileURLToPath } from "node:url";
import { z as z$1 } from "zod";
import { dirname, resolve } from "node:path";

//#region src/ai/tools/files/index.ts
const __dirname = dirname(fileURLToPath(import.meta.url));
const FilesValidateSchema = z$1.discriminatedUnion("action", [
	z$1.strictObject({
		action: z$1.literal("read"),
		keys: z$1.array(PrimaryKeyValidateSchema).optional(),
		query: QueryValidateSchema.optional()
	}),
	z$1.strictObject({
		action: z$1.literal("update"),
		data: FileItemValidateSchema,
		keys: z$1.array(PrimaryKeyValidateSchema).optional(),
		query: QueryValidateSchema.optional()
	}),
	z$1.strictObject({
		action: z$1.literal("delete"),
		keys: z$1.array(PrimaryKeyValidateSchema)
	}),
	z$1.strictObject({
		action: z$1.literal("import"),
		data: z$1.array(FileImportItemValidateSchema)
	})
]);
const FilesInputSchema = z$1.object({
	action: z$1.enum([
		"read",
		"update",
		"delete",
		"import"
	]).describe("The operation to perform"),
	query: QueryInputSchema.optional(),
	keys: z$1.array(PrimaryKeyInputSchema).optional(),
	data: z$1.array(FileItemInputSchema.extend({ ...FileImportItemInputSchema.shape }).partial()).optional()
});
const files = defineTool({
	name: "files",
	description: requireText(resolve(__dirname, "./prompt.md")),
	annotations: { title: "Directus - Files" },
	inputSchema: FilesInputSchema,
	validateSchema: FilesValidateSchema,
	endpoint({ data }) {
		if (!isObject(data) || !("id" in data)) return;
		return ["files", data["id"]];
	},
	async handler({ args, schema, accountability }) {
		const service = new FilesService({
			schema,
			accountability
		});
		if (args.action === "read") {
			const sanitizedQuery = await buildSanitizedQueryFromArgs(args, schema, accountability);
			let result = null;
			if (args.keys) result = await service.readMany(args.keys, sanitizedQuery);
			else result = await service.readByQuery(sanitizedQuery);
			return {
				type: "text",
				data: result
			};
		}
		if (args.action === "update") {
			const sanitizedQuery = await buildSanitizedQueryFromArgs(args, schema, accountability);
			let updatedKeys = [];
			if (Array.isArray(args.data)) updatedKeys = await service.updateBatch(args.data);
			else if (args.keys) updatedKeys = await service.updateMany(args.keys, args.data);
			else updatedKeys = await service.updateByQuery(sanitizedQuery, args.data);
			return {
				type: "text",
				data: await service.readMany(updatedKeys, sanitizedQuery)
			};
		}
		if (args.action === "delete") return {
			type: "text",
			data: await service.deleteMany(args.keys)
		};
		if (args.action === "import") {
			const savedKeys = [];
			for (const file of args.data) {
				const savedKey = await service.importOne(file.url, file.file);
				savedKeys.push(savedKey);
			}
			return {
				type: "text",
				data: savedKeys
			};
		}
		throw new Error("Invalid action.");
	}
});

//#endregion
export { FilesValidateSchema, files };