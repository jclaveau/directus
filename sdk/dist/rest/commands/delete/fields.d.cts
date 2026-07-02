import { DirectusField } from "../../../schema/field.cjs";
import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/delete/fields.d.ts

/**
 * Deletes the given field in the given collection.
 * @param collection
 * @param field
 * @returns
 * @throws Will throw if collection is empty
 * @throws Will throw if field is empty
 */
declare const deleteField: <Schema>(collection: DirectusField<Schema>["collection"], field: DirectusField<Schema>["field"]) => RestCommand<void, Schema>;
//#endregion
export { deleteField };
//# sourceMappingURL=fields.d.cts.map