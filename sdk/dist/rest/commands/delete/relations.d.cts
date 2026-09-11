import { DirectusRelation } from "../../../schema/relation.cjs";
import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/delete/relations.d.ts

/**
 * Delete an existing relation.
 * @param collection
 * @param field
 * @returns
 * @throws Will throw if collection is empty
 * @throws Will throw if field is empty
 */
declare const deleteRelation: <Schema>(collection: DirectusRelation<Schema>["collection"], field: DirectusRelation<Schema>["field"]) => RestCommand<void, Schema>;
//#endregion
export { deleteRelation };
//# sourceMappingURL=relations.d.cts.map