import { requireText } from "../../../utils/require-text.js";
import { defineTool } from "../define-tool.js";
import { RelationsService } from "../../../services/relations.js";
import { FieldsService } from "../../../services/fields.js";
import { CollectionsService } from "../../../services/collections.js";
import { fileURLToPath } from "node:url";
import { z as z$1 } from "zod";
import { dirname, resolve } from "node:path";

//#region src/ai/tools/schema/index.ts
const __dirname = dirname(fileURLToPath(import.meta.url));
const SchemaValidateSchema = z$1.strictObject({ keys: z$1.array(z$1.string()).optional() });
const SchemaInputSchema = z$1.object({ keys: z$1.array(z$1.string()).optional().describe("Collection names to get detailed schema for. If omitted, returns a lightweight list of all collections.") });
const schema = defineTool({
	name: "schema",
	description: requireText(resolve(__dirname, "./prompt.md")),
	annotations: { title: "Directus - Schema" },
	inputSchema: SchemaInputSchema,
	validateSchema: SchemaValidateSchema,
	async handler({ args, accountability, schema: schema$1 }) {
		const serviceOptions = {
			schema: schema$1,
			accountability
		};
		const collections = await new CollectionsService(serviceOptions).readByQuery();
		if (!args.keys || args.keys.length === 0) {
			const lightweightOverview = {
				collections: [],
				collection_folders: [],
				notes: {}
			};
			collections.forEach((collection) => {
				if (!collection.schema) lightweightOverview.collection_folders.push(collection.collection);
				else lightweightOverview.collections.push(collection.collection);
				if (collection.meta?.note && !collection.meta.note.startsWith("$t")) lightweightOverview.notes[collection.collection] = collection.meta.note;
			});
			return {
				type: "text",
				data: lightweightOverview
			};
		}
		const overview = {};
		const fields = await new FieldsService(serviceOptions).readAll();
		const snapshot = {
			collections,
			fields,
			relations: await new RelationsService(serviceOptions).readAll()
		};
		fields.forEach((field) => {
			if (!args.keys?.includes(field.collection)) return;
			if (field.type === "alias" && field.meta?.special?.includes("no-data")) return;
			if (!overview[field.collection]) overview[field.collection] = {};
			const fieldOverview = { type: field.type };
			if (field.schema?.is_primary_key) fieldOverview.primary_key = field.schema?.is_primary_key;
			if (field.meta?.required) fieldOverview.required = field.meta.required;
			if (field.meta?.readonly) fieldOverview.readonly = field.meta.readonly;
			if (field.meta?.note) fieldOverview.note = field.meta.note;
			if (field.meta?.interface) {
				fieldOverview.interface = { type: field.meta.interface };
				if (field.meta.options?.["choices"]) fieldOverview.interface.choices = field.meta.options["choices"].map((choice) => choice.value);
			}
			if (field.type === "json" && field.meta?.options?.["fields"]) {
				const nestedFields = field.meta.options["fields"];
				fieldOverview.fields = processNestedFields({
					fields: nestedFields,
					maxDepth: 5,
					currentDepth: 0,
					snapshot
				});
			}
			if (field.type === "json" && field.meta?.interface === "collection-item-dropdown") fieldOverview.fields = processCollectionItemDropdown({
				field,
				snapshot
			});
			if (field.meta?.special) {
				const relationshipType = getRelationType(field.meta.special);
				if (relationshipType) fieldOverview.relation = buildRelationInfo(field, relationshipType, snapshot);
			}
			overview[field.collection][field.field] = fieldOverview;
		});
		return {
			type: "text",
			data: overview
		};
	}
});
function processNestedFields(options) {
	const { fields, maxDepth = 5, currentDepth = 0, snapshot } = options;
	const result = {};
	if (currentDepth >= maxDepth) return result;
	if (!Array.isArray(fields)) return result;
	for (const field of fields) {
		const fieldKey = field.field || field.name;
		if (!fieldKey) continue;
		const fieldOverview = { type: field.type ?? "any" };
		if (field.meta) {
			const { required, readonly, note, interface: interfaceConfig, options: options$1 } = field.meta;
			if (required) fieldOverview.required = required;
			if (readonly) fieldOverview.readonly = readonly;
			if (note) fieldOverview.note = note;
			if (interfaceConfig) {
				fieldOverview.interface = { type: interfaceConfig };
				if (options$1?.choices) fieldOverview.interface.choices = options$1.choices;
			}
		}
		const nestedFields = field.meta?.options?.fields || field.options?.fields;
		if (field.type === "json" && nestedFields) fieldOverview.fields = processNestedFields({
			fields: nestedFields,
			maxDepth,
			currentDepth: currentDepth + 1,
			snapshot
		});
		if (field.type === "json" && field.meta?.interface === "collection-item-dropdown") fieldOverview.fields = processCollectionItemDropdown({
			field,
			snapshot
		});
		result[fieldKey] = fieldOverview;
	}
	return result;
}
function processCollectionItemDropdown(options) {
	const { field, snapshot } = options;
	const selectedCollection = field.meta?.options?.["selectedCollection"];
	let keyType = "string | number | uuid";
	if (selectedCollection && snapshot?.fields) {
		const primaryKeyField = snapshot.fields.find((f) => f.collection === selectedCollection && f.schema?.is_primary_key);
		if (primaryKeyField) keyType = primaryKeyField.type;
	}
	return {
		collection: {
			value: selectedCollection,
			type: "string"
		},
		key: { type: keyType }
	};
}
function getRelationType(special) {
	if (special.includes("m2o") || special.includes("file")) return "m2o";
	if (special.includes("o2m")) return "o2m";
	if (special.includes("m2m") || special.includes("files")) return "m2m";
	if (special.includes("m2a")) return "m2a";
	return null;
}
function buildRelationInfo(field, type, snapshot) {
	switch (type) {
		case "m2o": return buildManyToOneRelation(field, snapshot);
		case "o2m": return buildOneToManyRelation(field, snapshot);
		case "m2m": return buildManyToManyRelation(field, snapshot);
		case "m2a": return buildManyToAnyRelation(field, snapshot);
		default: return { type };
	}
}
function buildManyToOneRelation(field, snapshot) {
	const relation = snapshot.relations.find((r) => r.collection === field.collection && r.field === field.field);
	return {
		type: "m2o",
		collection: relation?.related_collection || relation?.schema?.foreign_key_table || field.schema?.foreign_key_table
	};
}
function buildOneToManyRelation(field, snapshot) {
	const reverseRelation = snapshot.relations.find((r) => r.meta?.one_collection === field.collection && r.meta?.one_field === field.field);
	if (!reverseRelation) return { type: "o2m" };
	return {
		type: "o2m",
		collection: reverseRelation.collection,
		many_field: reverseRelation.field
	};
}
function buildManyToManyRelation(field, snapshot) {
	const junctionRelation = snapshot.relations.find((r) => r.meta?.one_field === field.field && r.meta?.one_collection === field.collection && r.collection !== field.collection);
	if (!junctionRelation) return { type: "m2m" };
	const result = {
		type: "m2m",
		collection: snapshot.relations.find((r) => r.collection === junctionRelation.collection && r.field === junctionRelation.meta?.junction_field)?.related_collection || "directus_files",
		junction: {
			collection: junctionRelation.collection,
			many_field: junctionRelation.field,
			junction_field: junctionRelation.meta?.junction_field
		}
	};
	if (junctionRelation.meta?.sort_field) result.junction.sort_field = junctionRelation.meta.sort_field;
	return result;
}
function buildManyToAnyRelation(field, snapshot) {
	const junctionRelation = snapshot.relations.find((r) => r.meta?.one_field === field.field && r.meta?.one_collection === field.collection);
	if (!junctionRelation) return { type: "m2a" };
	const polymorphicRelation = snapshot.relations.find((r) => r.collection === junctionRelation.collection && r.meta?.one_allowed_collections && r.meta.one_allowed_collections.length > 0);
	if (!polymorphicRelation) return { type: "m2a" };
	const parentRelation = snapshot.relations.find((r) => r.collection === junctionRelation.collection && r.related_collection === field.collection && r.field !== polymorphicRelation.field);
	const result = {
		type: "m2a",
		one_allowed_collections: polymorphicRelation.meta?.one_allowed_collections,
		junction: {
			collection: junctionRelation.collection,
			many_field: parentRelation?.field || `${field.collection}_id`,
			junction_field: polymorphicRelation.field,
			one_collection_field: polymorphicRelation.meta?.one_collection_field || "collection"
		}
	};
	const sortField = parentRelation?.meta?.sort_field || polymorphicRelation.meta?.sort_field;
	if (sortField) result.junction.sort_field = sortField;
	return result;
}

//#endregion
export { SchemaInputSchema, SchemaValidateSchema, schema };