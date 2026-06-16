import { clearSystemCache } from "../../../cache.js";
import database_default from "../../../database/index.js";
import { transaction } from "../../../utils/transaction.js";
import { shouldClearCache } from "../../../utils/should-clear-cache.js";
import { requireText } from "../../../utils/require-text.js";
import { defineTool } from "../define-tool.js";
import { getSchema } from "../../../utils/get-schema.js";
import { FieldsService } from "../../../services/fields.js";
import { FieldItemInputSchema, FieldItemValidateSchema, RawFieldItemInputSchema, RawFieldItemValidateSchema } from "../schema.js";
import { InvalidPayloadError } from "@directus/errors";
import { toArray } from "@directus/utils";
import { fileURLToPath } from "node:url";
import { z as z$1 } from "zod";
import { dirname, resolve } from "node:path";

//#region src/ai/tools/fields/index.ts
const __dirname = dirname(fileURLToPath(import.meta.url));
const FieldsBaseValidateSchema = z$1.strictObject({ collection: z$1.string() });
const FieldsValidateSchema = z$1.discriminatedUnion("action", [
	FieldsBaseValidateSchema.extend({
		action: z$1.literal("create"),
		data: z$1.union([z$1.array(FieldItemValidateSchema), FieldItemValidateSchema])
	}),
	z$1.object({
		action: z$1.literal("read"),
		collection: z$1.string().optional(),
		field: z$1.string().optional()
	}),
	FieldsBaseValidateSchema.extend({
		action: z$1.literal("update"),
		data: z$1.array(RawFieldItemValidateSchema.partial({ type: true }))
	}),
	FieldsBaseValidateSchema.extend({
		action: z$1.literal("delete"),
		field: z$1.string()
	})
]);
const FieldsInputSchema = z$1.object({
	action: z$1.enum([
		"read",
		"create",
		"update",
		"delete"
	]).describe("The operation to perform"),
	collection: z$1.string().describe("The name of the collection").optional(),
	field: z$1.string().describe("The name of the field. Required for delete. Optional for read (omit to read all fields). Do not use for create or update.").optional(),
	data: z$1.array(FieldItemInputSchema.extend({ children: RawFieldItemInputSchema.shape.children }).partial().required({ field: true })).describe("Array of field objects for create/update actions. Each object must include \"field\" (the field name).").optional()
});
const fields = defineTool({
	name: "fields",
	admin: true,
	description: requireText(resolve(__dirname, "./prompt.md")),
	annotations: { title: "Directus - Fields" },
	inputSchema: FieldsInputSchema,
	validateSchema: FieldsValidateSchema,
	async handler({ args, schema, accountability }) {
		let service = new FieldsService({
			schema,
			accountability
		});
		if (args.action === "create") {
			const fields$1 = toArray(args.data);
			const knex = database_default();
			const result = [];
			await transaction(knex, async (trx) => {
				service = new FieldsService({
					schema,
					accountability,
					knex: trx
				});
				for (const field of fields$1) await service.createField(args.collection, field, void 0, {
					autoPurgeCache: false,
					autoPurgeSystemCache: false
				});
			});
			if (shouldClearCache(service.cache)) await service.cache.clear();
			await clearSystemCache();
			service = new FieldsService({
				schema: await getSchema(),
				accountability
			});
			for (const field of fields$1) {
				const createdField = await service.readOne(args.collection, field.field);
				result.push(createdField);
			}
			return {
				type: "text",
				data: result || null
			};
		}
		if (args.action === "read") {
			let result = null;
			if (args.collection) if (args.field) result = await service.readOne(args.collection, args.field);
			else result = await service.readAll(args.collection);
			else result = await service.readAll();
			return {
				type: "text",
				data: result || null
			};
		}
		if (args.action === "update") {
			const fields$1 = toArray(args.data);
			const knex = database_default();
			const result = [];
			await transaction(knex, async (trx) => {
				service = new FieldsService({
					schema,
					accountability,
					knex: trx
				});
				for (const field of fields$1) await service.updateField(args.collection, field, {
					autoPurgeCache: false,
					autoPurgeSystemCache: false
				});
			});
			if (shouldClearCache(service.cache)) await service.cache.clear();
			await clearSystemCache();
			service = new FieldsService({
				schema: await getSchema(),
				accountability
			});
			for (const field of fields$1) {
				const updatedField = await service.readOne(args.collection, field.field);
				result.push(updatedField);
			}
			return {
				type: "text",
				data: result || null
			};
		}
		if (args.action === "delete") {
			const { collection, field } = args;
			await service.deleteField(collection, field);
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
export { FieldsBaseValidateSchema, FieldsInputSchema, FieldsValidateSchema, fields };