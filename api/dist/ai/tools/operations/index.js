import { requireText } from "../../../utils/require-text.js";
import { defineTool } from "../define-tool.js";
import { OperationsService } from "../../../services/operations.js";
import { OperationItemInputSchema, OperationItemValidateSchema, QueryInputSchema, QueryValidateSchema } from "../schema.js";
import { buildSanitizedQueryFromArgs } from "../utils.js";
import { fileURLToPath } from "node:url";
import { z as z$1 } from "zod";
import { dirname, resolve } from "node:path";

//#region src/ai/tools/operations/index.ts
const __dirname = dirname(fileURLToPath(import.meta.url));
const OperationsValidationSchema = z$1.discriminatedUnion("action", [
	z$1.strictObject({
		action: z$1.literal("create"),
		data: OperationItemValidateSchema
	}),
	z$1.strictObject({
		action: z$1.literal("read"),
		query: QueryValidateSchema.optional()
	}),
	z$1.strictObject({
		action: z$1.literal("update"),
		data: OperationItemValidateSchema,
		key: z$1.string(),
		query: QueryValidateSchema.optional()
	}),
	z$1.strictObject({
		action: z$1.literal("delete"),
		key: z$1.string()
	})
]);
const OperationsInputSchema = z$1.object({
	action: z$1.enum([
		"create",
		"read",
		"update",
		"delete"
	]).describe("The operation to perform"),
	query: QueryInputSchema.optional(),
	data: OperationItemInputSchema.optional(),
	key: z$1.string().optional()
});
const operations = defineTool({
	name: "operations",
	admin: true,
	description: requireText(resolve(__dirname, "./prompt.md")),
	annotations: { title: "Directus - Operations" },
	inputSchema: OperationsInputSchema,
	validateSchema: OperationsValidationSchema,
	async handler({ args, schema, accountability }) {
		const operationService = new OperationsService({
			schema,
			accountability
		});
		if (args.action === "create") {
			const savedKey = await operationService.createOne(args.data);
			return {
				type: "text",
				data: await operationService.readOne(savedKey) || null
			};
		}
		if (args.action === "read") {
			const sanitizedQuery = await buildSanitizedQueryFromArgs(args, schema, accountability);
			return {
				type: "text",
				data: await operationService.readByQuery(sanitizedQuery) || null
			};
		}
		if (args.action === "update") {
			const sanitizedQuery = await buildSanitizedQueryFromArgs(args, schema, accountability);
			const updatedKey = await operationService.updateOne(args.key, args.data);
			return {
				type: "text",
				data: await operationService.readOne(updatedKey, sanitizedQuery) || null
			};
		}
		if (args.action === "delete") return {
			type: "text",
			data: await operationService.deleteOne(args.key)
		};
		throw new Error("Invalid action.");
	}
});

//#endregion
export { OperationsInputSchema, OperationsValidationSchema, operations };