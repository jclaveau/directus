import { requireText } from "../../../utils/require-text.js";
import { defineTool } from "../define-tool.js";
import { FlowsService } from "../../../services/flows.js";
import { FlowItemInputSchema, FlowItemValidateSchema, QueryInputSchema, QueryValidateSchema } from "../schema.js";
import { buildSanitizedQueryFromArgs } from "../utils.js";
import { isObject } from "@directus/utils";
import { fileURLToPath } from "node:url";
import { z as z$1 } from "zod";
import { dirname, resolve } from "node:path";

//#region src/ai/tools/flows/index.ts
const __dirname = dirname(fileURLToPath(import.meta.url));
const FlowsValidateSchema = z$1.discriminatedUnion("action", [
	z$1.strictObject({
		action: z$1.literal("create"),
		data: FlowItemValidateSchema
	}),
	z$1.strictObject({
		action: z$1.literal("read"),
		query: QueryValidateSchema.optional()
	}),
	z$1.strictObject({
		action: z$1.literal("update"),
		key: z$1.string(),
		data: FlowItemValidateSchema,
		query: QueryValidateSchema.optional()
	}),
	z$1.strictObject({
		action: z$1.literal("delete"),
		key: z$1.string()
	})
]);
const FlowsInputSchema = z$1.object({
	action: z$1.enum([
		"create",
		"read",
		"update",
		"delete"
	]).describe("The operation to perform"),
	query: QueryInputSchema.optional(),
	data: FlowItemInputSchema.optional(),
	key: z$1.string().optional()
});
const flows = defineTool({
	name: "flows",
	admin: true,
	description: requireText(resolve(__dirname, "./prompt.md")),
	annotations: { title: "Directus - Flows" },
	inputSchema: FlowsInputSchema,
	validateSchema: FlowsValidateSchema,
	endpoint({ data }) {
		if (!isObject(data) || !("id" in data)) return;
		return [
			"settings",
			"flows",
			data["id"]
		];
	},
	async handler({ args, schema, accountability }) {
		const flowsService = new FlowsService({
			schema,
			accountability
		});
		if (args.action === "create") {
			const savedKey = await flowsService.createOne(args.data);
			return {
				type: "text",
				data: await flowsService.readOne(savedKey) || null
			};
		}
		if (args.action === "read") {
			const sanitizedQuery = await buildSanitizedQueryFromArgs(args, schema, accountability);
			return {
				type: "text",
				data: await flowsService.readByQuery(sanitizedQuery) || null
			};
		}
		if (args.action === "update") {
			const sanitizedQuery = await buildSanitizedQueryFromArgs(args, schema, accountability);
			const updatedKey = await flowsService.updateOne(args.key, args.data);
			return {
				type: "text",
				data: await flowsService.readOne(updatedKey, sanitizedQuery) || null
			};
		}
		if (args.action === "delete") return {
			type: "text",
			data: await flowsService.deleteOne(args.key)
		};
		throw new Error("Invalid action.");
	}
});

//#endregion
export { FlowsInputSchema, FlowsValidateSchema, flows };