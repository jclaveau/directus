import { requireText } from "../../../utils/require-text.js";
import { defineTool } from "../define-tool.js";
import { RelationsService } from "../../../services/relations.js";
import { RelationItemInputSchema, RelationItemValidateCreateSchema, RelationItemValidateUpdateSchema } from "../schema.js";
import { InvalidPayloadError } from "@directus/errors";
import { fileURLToPath } from "node:url";
import { z as z$1 } from "zod";
import { dirname, resolve } from "node:path";

//#region src/ai/tools/relations/index.ts
const __dirname = dirname(fileURLToPath(import.meta.url));
const RelationsValidateSchema = z$1.discriminatedUnion("action", [
	z$1.object({
		action: z$1.literal("create"),
		collection: z$1.string(),
		field: z$1.string().optional(),
		data: RelationItemValidateCreateSchema
	}),
	z$1.object({
		action: z$1.literal("read"),
		collection: z$1.string().optional(),
		field: z$1.string().optional()
	}),
	z$1.object({
		action: z$1.literal("update"),
		collection: z$1.string(),
		field: z$1.string(),
		data: RelationItemValidateUpdateSchema
	}),
	z$1.object({
		action: z$1.literal("delete"),
		collection: z$1.string(),
		field: z$1.string()
	})
]);
const RelationsInputSchema = z$1.object({
	action: z$1.enum([
		"create",
		"read",
		"update",
		"delete"
	]).describe("The operation to perform"),
	collection: z$1.string().describe("The name of the collection (required for create, update, delete)").optional(),
	field: z$1.string().describe("The name of the field (required for create, update, delete)").optional(),
	data: RelationItemInputSchema.optional().describe("The relation data. (required for create, update)")
});
const relations = defineTool({
	name: "relations",
	admin: true,
	description: requireText(resolve(__dirname, "./prompt.md")),
	annotations: { title: "Directus - Relations" },
	inputSchema: RelationsInputSchema,
	validateSchema: RelationsValidateSchema,
	async handler({ args, schema, accountability }) {
		const service = new RelationsService({
			schema,
			accountability
		});
		if (args.action === "create") {
			await service.createOne(args.data);
			return {
				type: "text",
				data: await service.readOne(args.collection, args.field || args.data.field) || null
			};
		}
		if (args.action === "read") {
			let result = null;
			if (args.field && args.collection) result = await service.readOne(args.collection, args.field);
			else if (args.collection) result = await service.readAll(args.collection);
			else result = await service.readAll();
			return {
				type: "text",
				data: result || null
			};
		}
		if (args.action === "update") {
			await service.updateOne(args.collection, args.field, args.data);
			return {
				type: "text",
				data: await service.readOne(args.collection, args.field) || null
			};
		}
		if (args.action === "delete") {
			const { collection, field } = args;
			await service.deleteOne(collection, field);
			return {
				type: "text",
				data: {
					collection,
					field
				}
			};
		}
		throw new InvalidPayloadError({ reason: "Invalid action" });
	}
});

//#endregion
export { relations };