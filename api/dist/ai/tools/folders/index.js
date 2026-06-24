import { FoldersService } from "../../../services/folders.js";
import { requireText } from "../../../utils/require-text.js";
import { defineTool } from "../define-tool.js";
import { FolderItemInputSchema, FolderItemValidateSchema, PrimaryKeyInputSchema, PrimaryKeyValidateSchema, QueryInputSchema, QueryValidateSchema } from "../schema.js";
import { buildSanitizedQueryFromArgs } from "../utils.js";
import { toArray } from "@directus/utils";
import { fileURLToPath } from "node:url";
import { z as z$1 } from "zod";
import { dirname, resolve } from "node:path";

//#region src/ai/tools/folders/index.ts
const __dirname = dirname(fileURLToPath(import.meta.url));
const FoldersValidateSchema = z$1.discriminatedUnion("action", [
	z$1.strictObject({
		action: z$1.literal("create"),
		data: z$1.union([z$1.array(FolderItemValidateSchema), FolderItemValidateSchema]),
		query: QueryValidateSchema.optional()
	}),
	z$1.strictObject({
		action: z$1.literal("read"),
		keys: z$1.array(PrimaryKeyValidateSchema).optional(),
		query: QueryValidateSchema.optional()
	}),
	z$1.strictObject({
		action: z$1.literal("update"),
		data: FolderItemValidateSchema,
		keys: z$1.array(PrimaryKeyValidateSchema).optional(),
		query: QueryValidateSchema.optional()
	}),
	z$1.strictObject({
		action: z$1.literal("delete"),
		keys: z$1.array(PrimaryKeyValidateSchema)
	})
]);
const FoldersInputSchema = z$1.object({
	action: z$1.enum([
		"create",
		"read",
		"update",
		"delete"
	]).describe("The operation to perform"),
	query: QueryInputSchema.optional(),
	keys: z$1.array(PrimaryKeyInputSchema).optional(),
	data: z$1.array(FolderItemInputSchema).optional()
});
const folders = defineTool({
	name: "folders",
	description: requireText(resolve(__dirname, "./prompt.md")),
	annotations: { title: "Directus - Folders" },
	inputSchema: FoldersInputSchema,
	validateSchema: FoldersValidateSchema,
	async handler({ args, schema, accountability }) {
		const service = new FoldersService({
			schema,
			accountability
		});
		if (args.action === "create") {
			const sanitizedQuery = await buildSanitizedQueryFromArgs(args, schema, accountability);
			const data = toArray(args.data);
			const savedKeys = await service.createMany(data);
			return {
				type: "text",
				data: await service.readMany(savedKeys, sanitizedQuery) || null
			};
		}
		if (args.action === "read") {
			const sanitizedQuery = await buildSanitizedQueryFromArgs(args, schema, accountability);
			let result = null;
			if (args.keys) result = await service.readMany(args.keys, sanitizedQuery);
			else result = await service.readByQuery(sanitizedQuery);
			return {
				type: "text",
				data: result || null
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
		throw new Error("Invalid action.");
	}
});

//#endregion
export { folders };