import { IfAny, UnpackList } from "./utils.cjs";
import { ItemType } from "./schema.cjs";
import { QueryDeep } from "./deep.cjs";
import { HasNestedFields, QueryFields } from "./fields.cjs";
import { QueryFilter } from "./filters.cjs";

//#region src/types/query.d.ts

/**
 * All query options available
 */
interface Query<Schema, Item> {
  readonly fields?: IfAny<Schema, (string | Record<string, any>)[], QueryFields<Schema, Item>> | undefined;
  filter?: IfAny<Schema, Record<string, any>, QueryFilter<Schema, Item>> | undefined;
  search?: string | undefined;
  sort?: IfAny<Schema, string | string[], QuerySort<Schema, Item> | QuerySort<Schema, Item>[]> | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
  page?: number | undefined;
  deep?: IfAny<Schema, Record<string, any>, QueryDeep<Schema, Item>> | undefined;
  backlink?: boolean | undefined;
  readonly alias?: IfAny<Schema, Record<string, string>, QueryAlias<Schema, Item>> | undefined;
}
/**
 * All query options with an additional version query option for readItem and readSingleton
 */
interface QueryItem<Schema, Item> extends Query<Schema, Item> {
  readonly version?: string | undefined;
  readonly versionRaw?: boolean | undefined;
}
/**
 * How a create or an update batches its statements: `preserveMutationOrder`, the
 * default unless the server's DEFAULT_MUTATION_BATCHING says otherwise, writes
 * them in the order sent; `minimizeMutations` writes a run's updates before its
 * creates; `disableBatching` writes one row at a time, each with its own hooks.
 */
type MutationBatching = 'minimizeMutations' | 'preserveMutationOrder' | 'disableBatching';
/**
 * All query options with additional mutationBatching and nestedUpdates options
 * for the create and update commands.
 */
interface QueryMutation<Schema, Item> extends Query<Schema, Item> {
  readonly mutationBatching?: MutationBatching | undefined;
  /**
   * What a nested record carrying an existing row's key and more fields does:
   * `apply`, the default, updates that row; `refuse` refuses the mutation with
   * a 400; `skip` only names the row, leaving its fields as they are.
   */
  readonly nestedUpdates?: 'apply' | 'refuse' | 'skip' | undefined;
}
/**
 * All query options with an additional onRepeatedPk option for updateItems and
 * updateItemsBatch: `refuse`, the default, refuses an update sending a row more
 * than once, `lastWins` writes every change in the order sent.
 */
interface QueryUpdate<Schema, Item> extends QueryMutation<Schema, Item> {
  readonly onRepeatedPk?: 'refuse' | 'lastWins' | undefined;
}
/**
 * Returns Item types that are available in the root Schema
 */
type ExtractItem<Schema, Item> = Extract<UnpackList<Item>, ItemType<Schema>>;
/**
 * Returns the relation type from the current item by key
 */
type ExtractRelation<Schema, Item extends object, Key$1> = Key$1 extends keyof Item ? ExtractItem<Schema, Item[Key$1]> : never;
/**
 * Merge union of optional objects
 */
type MergeRelationalFields<FieldList> = Exclude<UnpackList<FieldList>, string> extends infer RelatedFields ? { [Key in RelatedFields extends any ? keyof RelatedFields : never]-?: Exclude<RelatedFields[Key], undefined> } : never;
/**
 * Merge separate relational objects together
 */
type MergeFields<FieldList> = HasNestedFields<FieldList> extends never ? Extract<UnpackList<FieldList>, string> : Extract<UnpackList<FieldList>, string> | MergeRelationalFields<FieldList>;
/**
 * Query sort
 * TODO expand to relational sorting (same object notation as fields i guess)
 */
type QuerySort<_Schema, Item> = UnpackList<Item> extends infer FlatItem ? { [Field in keyof FlatItem]: Field | `-${Field & string}` }[keyof FlatItem] : never;
type MergeObjects<A, B> = object extends A ? (object extends B ? A & B : A) : object extends B ? B : never;
/**
 * Alias object
 *
 * TODO somehow include these aliases in the Field Types!!
 */
type QueryAlias<_Schema, Item> = Record<string, keyof Item>;
//#endregion
export { ExtractItem, ExtractRelation, MergeFields, MergeObjects, MergeRelationalFields, MutationBatching, Query, QueryAlias, QueryItem, QueryMutation, QuerySort, QueryUpdate };
//# sourceMappingURL=query.d.cts.map