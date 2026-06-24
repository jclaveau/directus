import { ItemsService } from "../../../services/items.js";
import { requireText } from "../../../utils/require-text.js";
import { defineTool } from "../define-tool.js";
import { ItemInputSchema, ItemValidateSchema, PrimaryKeyInputSchema, PrimaryKeyValidateSchema, QueryInputSchema, QueryValidateSchema } from "../schema.js";
import { buildSanitizedQueryFromArgs } from "../utils.js";
import { ForbiddenError, InvalidPayloadError } from "@directus/errors";
import { toArray } from "@directus/utils";
import { fileURLToPath } from "node:url";
import { z as z$1 } from "zod";
import { dirname, resolve } from "node:path";
import { isSystemCollection } from "@directus/system-data";
import { isObject as isObject$1 } from "graphql-compose";

//#region src/ai/tools/items/index.ts
const __dirname = dirname(fileURLToPath(import.meta.url));
const PartialItemInputSchema = z$1.strictObject({ collection: z$1.string() });
const ItemsValidateSchema = z$1.discriminatedUnion("action", [
	PartialItemInputSchema.extend({
		action: z$1.literal("create"),
		data: z$1.union([z$1.array(ItemValidateSchema), ItemValidateSchema]),
		query: QueryValidateSchema.optional()
	}),
	PartialItemInputSchema.extend({
		action: z$1.literal("read"),
		keys: z$1.array(PrimaryKeyValidateSchema).optional(),
		query: QueryValidateSchema.optional()
	}),
	PartialItemInputSchema.extend({
		action: z$1.literal("update"),
		data: z$1.union([z$1.array(ItemValidateSchema), ItemValidateSchema]),
		keys: z$1.array(PrimaryKeyValidateSchema).optional(),
		query: QueryValidateSchema.optional()
	}),
	PartialItemInputSchema.extend({
		action: z$1.literal("delete"),
		keys: z$1.array(PrimaryKeyValidateSchema)
	})
]);
const ItemsInputSchema = z$1.object({
	action: z$1.enum([
		"create",
		"read",
		"update",
		"delete"
	]).describe("The operation to perform"),
	collection: z$1.string().describe("The name of the collection"),
	query: QueryInputSchema.optional(),
	keys: z$1.array(PrimaryKeyInputSchema).optional(),
	data: z$1.union([z$1.array(ItemInputSchema), ItemInputSchema]).optional().describe("Object when using keys, array with PKs for batch updates")
});
const items = defineTool({
	name: "items",
	description: requireText(resolve(__dirname, "./prompt.md")),
	annotations: { title: "Directus - Items" },
	inputSchema: ItemsInputSchema,
	validateSchema: ItemsValidateSchema,
	endpoint({ input, data }) {
		if (!isObject$1(data) || !("id" in data)) return;
		return [
			"content",
			input.collection,
			data["id"]
		];
	},
	async handler({ args, schema, accountability }) {
		if (isSystemCollection(args.collection)) throw new InvalidPayloadError({ reason: "Cannot provide a core collection" });
		if (args.collection in schema.collections === false) throw new ForbiddenError();
		const isSingleton = schema.collections[args.collection]?.singleton ?? false;
		const itemsService = new ItemsService(args.collection, {
			schema,
			accountability
		});
		if (args.action === "create") {
			const sanitizedQuery = await buildSanitizedQueryFromArgs(args, schema, accountability);
			const data = toArray(args.data);
			if (isSingleton) {
				if (Array.isArray(args.data)) throw new InvalidPayloadError({ reason: "Invalid data payload, object exptected" });
				await itemsService.upsertSingleton(args.data);
				return {
					type: "text",
					data: await itemsService.readSingleton(sanitizedQuery) || null
				};
			}
			const savedKeys = await itemsService.createMany(data);
			return {
				type: "text",
				data: await itemsService.readMany(savedKeys, sanitizedQuery) || null
			};
		}
		if (args.action === "read") {
			const sanitizedQuery = await buildSanitizedQueryFromArgs(args, schema, accountability);
			let result = null;
			if (isSingleton) result = await itemsService.readSingleton(sanitizedQuery);
			else if (args.keys) result = await itemsService.readMany(args.keys, sanitizedQuery);
			else result = await itemsService.readByQuery(sanitizedQuery);
			return {
				type: "text",
				data: result
			};
		}
		if (args.action === "update") {
			const sanitizedQuery = await buildSanitizedQueryFromArgs(args, schema, accountability);
			if (isSingleton) {
				if (Array.isArray(args.data)) throw new InvalidPayloadError({ reason: "Invalid data payload, object exptected" });
				await itemsService.upsertSingleton(args.data);
				return {
					type: "text",
					data: await itemsService.readSingleton(sanitizedQuery) || null
				};
			}
			let updatedKeys = [];
			if (Array.isArray(args.data)) updatedKeys = await itemsService.updateBatch(args.data);
			else if (args.keys) updatedKeys = await itemsService.updateMany(args.keys, args.data);
			else updatedKeys = await itemsService.updateByQuery(sanitizedQuery, args.data);
			return {
				type: "text",
				data: await itemsService.readMany(updatedKeys, sanitizedQuery)
			};
		}
		if (args.action === "delete") return {
			type: "text",
			data: await itemsService.deleteMany(args.keys)
		};
		throw new Error("Invalid action.");
	}
});

//#endregion
export { items };