import { z as z$1 } from "zod";

//#region src/ai/tools/schema.ts
const PrimaryKeyInputSchema = z$1.union([z$1.number(), z$1.string()]);
const PrimaryKeyValidateSchema = z$1.union([z$1.number(), z$1.string()]);
const ItemInputSchema = z$1.record(z$1.string(), z$1.any());
const ItemValidateSchema = z$1.record(z$1.string(), z$1.any());
const QueryInputSchema = z$1.object({
	fields: z$1.array(z$1.string()),
	sort: z$1.array(z$1.string()),
	filter: z$1.record(z$1.string(), z$1.any()),
	limit: z$1.number(),
	offset: z$1.number(),
	page: z$1.number(),
	search: z$1.string(),
	deep: z$1.record(z$1.string(), z$1.any()),
	alias: z$1.record(z$1.string(), z$1.string()),
	aggregate: z$1.object({
		count: z$1.array(z$1.string()).optional(),
		sum: z$1.array(z$1.string()).optional(),
		avg: z$1.array(z$1.string()).optional(),
		min: z$1.array(z$1.string()).optional(),
		max: z$1.array(z$1.string()).optional()
	}),
	backlink: z$1.boolean(),
	version: z$1.string(),
	versionRaw: z$1.boolean(),
	export: z$1.string(),
	groupBy: z$1.array(z$1.string())
}).partial();
const QueryValidateSchema = QueryInputSchema;
const RawFieldItemInputSchema = z$1.object({
	field: z$1.string(),
	type: z$1.string(),
	name: z$1.string().optional(),
	children: z$1.union([z$1.array(z$1.record(z$1.string(), z$1.any())), z$1.null()]).optional(),
	collection: z$1.string().optional(),
	schema: z$1.union([z$1.record(z$1.string(), z$1.any()), z$1.null()]).optional(),
	meta: z$1.union([z$1.record(z$1.string(), z$1.any()), z$1.null()]).optional()
});
const RawFieldItemValidateSchema = RawFieldItemInputSchema;
const FieldItemInputSchema = z$1.object({
	field: z$1.string(),
	type: z$1.string().nullable(),
	name: z$1.string().optional(),
	collection: z$1.string().optional(),
	schema: z$1.union([z$1.record(z$1.string(), z$1.any()), z$1.null()]).optional(),
	meta: z$1.union([z$1.record(z$1.string(), z$1.any()), z$1.null()]).optional()
});
const FieldItemValidateSchema = FieldItemInputSchema;
const CollectionItemInputSchema = z$1.object({
	collection: z$1.string(),
	fields: z$1.array(RawFieldItemInputSchema).optional(),
	meta: z$1.union([z$1.record(z$1.string(), z$1.any()), z$1.null()]).optional(),
	schema: z$1.union([z$1.object({}), z$1.null()]).optional().describe("ALWAYS an empty object for new collections. Only send `null` or `undefined` for folder collections.")
});
const CollectionItemValidateCreateSchema = CollectionItemInputSchema;
const CollectionItemValidateUpdateSchema = z$1.object({
	collection: z$1.string(),
	meta: z$1.union([z$1.record(z$1.string(), z$1.any()), z$1.null()]).optional(),
	schema: z$1.union([z$1.record(z$1.string(), z$1.any()), z$1.null()]).optional()
});
const FileItemInputSchema = z$1.object({
	id: z$1.string(),
	storage: z$1.string(),
	filename_disk: z$1.string(),
	filename_download: z$1.string(),
	title: z$1.union([z$1.string(), z$1.null()]),
	type: z$1.union([z$1.string(), z$1.null()]),
	folder: z$1.union([z$1.string(), z$1.null()]),
	created_on: z$1.string(),
	uploaded_by: z$1.union([z$1.string(), z$1.null()]),
	uploaded_on: z$1.union([z$1.string(), z$1.null()]),
	modified_by: z$1.union([z$1.string(), z$1.null()]),
	modified_on: z$1.string(),
	charset: z$1.union([z$1.string(), z$1.null()]),
	filesize: z$1.number(),
	width: z$1.union([z$1.number(), z$1.null()]),
	height: z$1.union([z$1.number(), z$1.null()]),
	duration: z$1.union([z$1.number(), z$1.null()]),
	embed: z$1.union([z$1.string(), z$1.null()]),
	description: z$1.union([z$1.string(), z$1.null()]),
	location: z$1.union([z$1.string(), z$1.null()]),
	tags: z$1.union([z$1.string(), z$1.null()]),
	metadata: z$1.union([z$1.record(z$1.string(), z$1.any()), z$1.null()]),
	focal_point_x: z$1.union([z$1.number(), z$1.null()]),
	focal_point_y: z$1.union([z$1.number(), z$1.null()]),
	tus_id: z$1.union([z$1.string(), z$1.null()]),
	tus_data: z$1.union([z$1.record(z$1.string(), z$1.any()), z$1.null()])
}).partial();
const FileItemValidateSchema = FileItemInputSchema;
const FileImportItemInputSchema = z$1.object({
	url: z$1.string(),
	file: FileItemInputSchema
});
const FileImportItemValidateSchema = z$1.object({
	url: z$1.string(),
	file: FileItemValidateSchema
});
const OperationItemInputSchema = z$1.object({
	id: z$1.string(),
	name: z$1.union([z$1.string(), z$1.null()]),
	key: z$1.string(),
	type: z$1.string(),
	position_x: z$1.number(),
	position_y: z$1.number(),
	options: z$1.record(z$1.string(), z$1.any()),
	resolve: z$1.union([z$1.string(), z$1.null()]),
	reject: z$1.union([z$1.string(), z$1.null()]),
	flow: z$1.string(),
	date_created: z$1.string(),
	user_created: z$1.string()
}).partial();
const OperationItemValidateSchema = OperationItemInputSchema;
const FlowItemInputSchema = z$1.object({
	id: z$1.string(),
	name: z$1.string(),
	icon: z$1.union([z$1.string(), z$1.null()]),
	color: z$1.union([z$1.string(), z$1.null()]),
	description: z$1.union([z$1.string(), z$1.null()]),
	status: z$1.enum(["active", "inactive"]),
	trigger: z$1.enum([
		"event",
		"schedule",
		"operation",
		"webhook",
		"manual"
	]),
	options: z$1.union([z$1.record(z$1.string(), z$1.any()), z$1.null()]),
	operation: z$1.union([z$1.string(), z$1.null()]),
	operations: z$1.array(OperationItemInputSchema),
	date_created: z$1.string(),
	user_created: z$1.string(),
	accountability: z$1.enum(["all", "activity"])
}).partial();
const FlowItemValidateSchema = FlowItemInputSchema;
const TriggerFlowInputSchema = z$1.object({
	id: PrimaryKeyInputSchema,
	collection: z$1.string(),
	keys: z$1.array(PrimaryKeyInputSchema).optional(),
	headers: z$1.record(z$1.string(), z$1.any()).optional(),
	query: z$1.record(z$1.string(), z$1.any()).optional(),
	data: z$1.record(z$1.string(), z$1.any()).optional()
});
const TriggerFlowValidateSchema = z$1.strictObject({
	id: PrimaryKeyValidateSchema,
	collection: z$1.string(),
	keys: z$1.array(PrimaryKeyValidateSchema).optional(),
	query: z$1.record(z$1.string(), z$1.any()).optional(),
	headers: z$1.record(z$1.string(), z$1.any()).optional(),
	data: z$1.record(z$1.string(), z$1.any()).optional()
});
const FolderItemInputSchema = z$1.object({
	id: PrimaryKeyInputSchema.optional(),
	name: z$1.string(),
	parent: z$1.string().optional()
});
const FolderItemValidateSchema = FolderItemInputSchema;
const RelationItemInputSchema = z$1.object({
	collection: z$1.string(),
	field: z$1.string(),
	related_collection: z$1.union([z$1.string(), z$1.null()]),
	schema: z$1.union([z$1.record(z$1.string(), z$1.any()), z$1.null()]),
	meta: z$1.union([z$1.record(z$1.string(), z$1.any()), z$1.null()])
});
const RelationMetaSchema = z$1.object({
	id: z$1.number(),
	many_collection: z$1.string(),
	many_field: z$1.string(),
	one_collection: z$1.string().nullable(),
	one_field: z$1.string().nullable(),
	one_collection_field: z$1.string().nullable(),
	one_allowed_collections: z$1.array(z$1.string()).nullable(),
	one_deselect_action: z$1.enum(["nullify", "delete"]),
	junction_field: z$1.string().nullable(),
	sort_field: z$1.string().nullable(),
	system: z$1.boolean().optional()
});
const FkActionEnum = z$1.enum([
	"NO ACTION",
	"RESTRICT",
	"CASCADE",
	"SET NULL",
	"SET DEFAULT"
]);
const ForeignKeySchema = z$1.object({
	table: z$1.string(),
	column: z$1.string(),
	foreign_key_table: z$1.string(),
	foreign_key_column: z$1.string(),
	foreign_key_schema: z$1.string().optional(),
	constraint_name: z$1.union([z$1.string(), z$1.null()]),
	on_update: z$1.union([FkActionEnum, z$1.null()]),
	on_delete: z$1.union([FkActionEnum, z$1.null()])
});
const RelationItemValidateCreateSchema = z$1.object({
	collection: z$1.string(),
	field: z$1.string(),
	related_collection: z$1.string().nullable(),
	schema: ForeignKeySchema.partial().nullable().optional(),
	meta: RelationMetaSchema.partial().nullable()
});
const RelationItemValidateUpdateSchema = z$1.object({
	collection: z$1.string(),
	field: z$1.string(),
	related_collection: z$1.string().nullable().optional(),
	schema: ForeignKeySchema.partial().nullable().optional(),
	meta: RelationMetaSchema.partial().nullable().optional()
}).optional();

//#endregion
export { CollectionItemInputSchema, CollectionItemValidateCreateSchema, CollectionItemValidateUpdateSchema, FieldItemInputSchema, FieldItemValidateSchema, FileImportItemInputSchema, FileImportItemValidateSchema, FileItemInputSchema, FileItemValidateSchema, FlowItemInputSchema, FlowItemValidateSchema, FolderItemInputSchema, FolderItemValidateSchema, ForeignKeySchema, ItemInputSchema, ItemValidateSchema, OperationItemInputSchema, OperationItemValidateSchema, PrimaryKeyInputSchema, PrimaryKeyValidateSchema, QueryInputSchema, QueryValidateSchema, RawFieldItemInputSchema, RawFieldItemValidateSchema, RelationItemInputSchema, RelationItemValidateCreateSchema, RelationItemValidateUpdateSchema, TriggerFlowInputSchema, TriggerFlowValidateSchema };