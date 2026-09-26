import { CoreSchema } from "../schema/core.js";
import { IfAny, UnpackList } from "./utils.js";

//#region src/types/schema.d.ts

/**
 * Get all available top level Item types from a given Schema
 */
type ItemType<Schema> = Schema[keyof Schema] | { [K in keyof Schema]: Schema[K] extends any[] ? Schema[K][number] : never }[keyof Schema];
/**
 * Return singular collection type
 */
type CollectionType<Schema, Collection$1> = IfAny<Schema, any, Collection$1 extends keyof Schema ? UnpackList<Schema[Collection$1]> extends object ? UnpackList<Schema[Collection$1]> : never : never>;
/**
 * Returns a list of singleton collections in the schema
 */
type SingletonCollections<Schema> = { [Key in keyof Schema]: Schema[Key] extends any[] ? never : Key }[keyof Schema];
/**
 * Returns a list of regular collections in the schema
 */
type RegularCollections<Schema> = IfAny<Schema, string, Exclude<keyof Schema, SingletonCollections<Schema>>>;
/**
 * Return string keys of all Primitive fields in the given schema Item
 */
type PrimitiveFields<Schema, Item$1> = { [Key in keyof Item$1]: Extract<Item$1[Key], ItemType<Schema>> extends never ? Key : never }[keyof Item$1];
/**
 * Return string keys of all Relational fields in the given schema Item
 */
type RelationalFields<Schema, Item$1> = { [Key in keyof Item$1]: Extract<Item$1[Key], ItemType<Schema>> extends never ? never : Key }[keyof Item$1];
/**
 * Remove the related Item types from relational m2o/a2o fields
 */
type RemoveRelationships<Schema, Item$1> = { [Key in keyof Item$1]: Exclude<Item$1[Key], ItemType<Schema>> };
/**
 * Merge a core collection from the schema with the builtin schema
 */
type MergeCoreCollection<Schema, Collection$1 extends keyof Schema | string, BuiltinCollection> = IfAny<Schema, BuiltinCollection, Collection$1 extends keyof Schema ? UnpackList<Schema[Collection$1]> extends infer Item ? { [Field in Exclude<keyof Item, keyof BuiltinCollection>]: Item[Field] } & BuiltinCollection : never : BuiltinCollection>;
/**
 * Merge custom and core schema objects
 */
type CompleteSchema<Schema> = CoreSchema<Schema> extends infer Core ? { [Collection in keyof Schema | keyof Core]: Collection extends keyof Core ? Core[Collection] : Collection extends keyof Schema ? Schema[Collection] : never } : never;
/**
 * Merge custom schema with core schema
 */
type AllCollections<Schema> = RegularCollections<Schema> | RegularCollections<CoreSchema<Schema>>;
/**
 * Helper to extract a collection with fallback to defaults
 */
type GetCollection<Schema, CollectionName extends AllCollections<Schema>> = CollectionName extends keyof CoreSchema<Schema> ? CoreSchema<Schema>[CollectionName] : CollectionName extends keyof Schema ? Schema[CollectionName] : never;
/**
 * Helper to extract a collection name
 */
type GetCollectionName<Schema, Collection$1, FullSchema = CompleteSchema<Schema>> = { [K in keyof FullSchema]: UnpackList<FullSchema[K]> extends Collection$1 ? K : never }[keyof FullSchema];
//#endregion
export { AllCollections, CollectionType, CompleteSchema, GetCollection, GetCollectionName, ItemType, MergeCoreCollection, PrimitiveFields, RegularCollections, RelationalFields, RemoveRelationships, SingletonCollections };
//# sourceMappingURL=schema.d.ts.map