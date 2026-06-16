import { requireText } from "../../../utils/require-text.js";
import { defineTool } from "../define-tool.js";
import { CollectionsService } from "../../../services/collections.js";
import { CollectionItemInputSchema, CollectionItemValidateCreateSchema, CollectionItemValidateUpdateSchema } from "../schema.js";
import { InvalidPayloadError } from "@directus/errors";
import { isObject, toArray } from "@directus/utils";
import { fileURLToPath } from "node:url";
import { z as z$1 } from "zod";
import { dirname, resolve } from "node:path";

//#region src/ai/tools/collections/index.ts
const __dirname = dirname(fileURLToPath(import.meta.url));
const CollectionsValidateSchema = z$1.discriminatedUnion("action", [
	z$1.strictObject({
		action: z$1.literal("create"),
		data: z$1.array(CollectionItemValidateCreateSchema)
	}),
	z$1.strictObject({
		action: z$1.literal("read"),
		keys: z$1.array(z$1.string()).optional()
	}),
	z$1.strictObject({
		action: z$1.literal("update"),
		data: z$1.array(CollectionItemValidateUpdateSchema)
	}),
	z$1.strictObject({
		action: z$1.literal("delete"),
		keys: z$1.array(z$1.string())
	})
]);
const CollectionsInputSchema = z$1.object({
	action: z$1.enum([
		"create",
		"read",
		"update",
		"delete"
	]).describe("The operation to perform"),
	keys: z$1.array(z$1.string()).optional(),
	data: z$1.array(CollectionItemInputSchema).optional()
});
const collections = defineTool({
	name: "collections",
	admin: true,
	description: requireText(resolve(__dirname, "./prompt.md")),
	annotations: { title: "Directus - Collections" },
	inputSchema: CollectionsInputSchema,
	validateSchema: CollectionsValidateSchema,
	endpoint({ data }) {
		if (!isObject(data) || !("collection" in data)) return;
		return ["content", data["collection"]];
	},
	async handler({ args, schema, accountability }) {
		const service = new CollectionsService({
			schema,
			accountability
		});
		if (args.action === "create") {
			const data = toArray(args.data);
			const savedKeys = await service.createMany(data);
			return {
				type: "text",
				data: await service.readMany(savedKeys) || null
			};
		}
		if (args.action === "read") {
			let result = null;
			if (args.keys) result = await service.readMany(args.keys);
			else result = await service.readByQuery();
			return {
				type: "text",
				data: result || null
			};
		}
		if (args.action === "update") {
			const updatedKeys = await service.updateBatch(toArray(args.data));
			return {
				type: "text",
				data: await service.readMany(updatedKeys) || null
			};
		}
		if (args.action === "delete") return {
			type: "text",
			data: await service.deleteMany(args.keys)
		};
		throw new InvalidPayloadError({ reason: "Invalid action" });
	}
});

//#endregion
export { CollectionsInputSchema, CollectionsValidateSchema, collections };