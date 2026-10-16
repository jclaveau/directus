import { DirectusRelation } from "../../../schema/relation.js";
import { ApplyQueryFields } from "../../../types/output.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/read/relations.d.ts
type ReadRelationOutput<Schema> = ApplyQueryFields<Schema, DirectusRelation<Schema>, '*'>;
/**
 * List all Relations that exist in Directus.
 * @returns An array of Relation objects. If no items are available, data will be an empty array.
 */
declare const readRelations: <Schema>() => RestCommand<ReadRelationOutput<Schema>[], Schema>;
/**
 * List all Relations of a collection.
 * @param collection The collection
 * @returns Returns an array of Relation objects if a valid collection name was provided.
 */
declare const readRelationByCollection: <Schema>(collection: DirectusRelation<Schema>["collection"]) => RestCommand<ReadRelationOutput<Schema>[], Schema>;
/**
 * List an existing Relation by collection and field name.
 * @param collection The collection
 * @param field The field
 * @returns Returns a Relation object if a valid collection and field name was provided.
 * @throws Will throw if collection is empty
 * @throws Will throw if field is empty
 */
declare const readRelation: <Schema>(collection: DirectusRelation<Schema>["collection"], field: DirectusRelation<Schema>["field"]) => RestCommand<ReadRelationOutput<Schema>, Schema>;
//#endregion
export { ReadRelationOutput, readRelation, readRelationByCollection, readRelations };
//# sourceMappingURL=relations.d.ts.map