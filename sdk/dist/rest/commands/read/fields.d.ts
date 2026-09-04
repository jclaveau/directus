import { DirectusField } from "../../../schema/field.js";
import { ApplyQueryFields } from "../../../types/output.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/read/fields.d.ts
type ReadFieldOutput<Schema, Item extends object = DirectusField<Schema>> = ApplyQueryFields<Schema, Item, '*'>;
/**
 * List the available fields.
 * @param query The query parameters
 * @returns An array of field objects.
 */
declare const readFields: <Schema>() => RestCommand<ReadFieldOutput<Schema>[], Schema>;
/**
 * List the available fields in a given collection.
 * @param collection The primary key of the field
 * @returns
 * @throws Will throw if collection is empty
 */
declare const readFieldsByCollection: <Schema>(collection: DirectusField<Schema>["collection"]) => RestCommand<ReadFieldOutput<Schema>[], Schema>;
/**
 *
 * @param key The primary key of the dashboard
 * @param query The query parameters
 * @returns
 * @throws Will throw if collection is empty
 * @throws Will throw if field is empty
 */
declare const readField: <Schema>(collection: DirectusField<Schema>["collection"], field: DirectusField<Schema>["field"]) => RestCommand<ReadFieldOutput<Schema>, Schema>;
//#endregion
export { ReadFieldOutput, readField, readFields, readFieldsByCollection };
//# sourceMappingURL=fields.d.ts.map