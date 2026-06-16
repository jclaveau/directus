import { DirectusField } from "../../../schema/field.js";
import { NestedPartial } from "../../../types/utils.js";
import { ApplyQueryFields } from "../../../types/output.js";
import { FieldQuery, Query } from "../../../types/query.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/update/fields.d.ts
type UpdateFieldOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusField<Schema>> = ApplyQueryFields<Schema, Item, TQuery["fields"]>;
/**
* Updates the given field in the given collection.
* @param collection
* @param field
* @param item
* @param query
* @returns
* @throws Will throw if collection is empty
* @throws Will throw if field is empty
*/
declare const updateField: <Schema, const TQuery extends FieldQuery<Schema, DirectusField<Schema>>>(collection: DirectusField<Schema>["collection"], field: DirectusField<Schema>["field"], item: NestedPartial<DirectusField<Schema>>, query?: TQuery) => RestCommand<UpdateFieldOutput<Schema, TQuery>, Schema>;
/**
* Updates the multiple field in the given collection.
* Update multiple existing fields.
* @param collection
* @param items
* @param query
* @returns
* @throws Will throw if collection is empty
*/
declare const updateFields: <Schema, const TQuery extends FieldQuery<Schema, DirectusField<Schema>>>(collection: DirectusField<Schema>["collection"], items: NestedPartial<DirectusField<Schema>>[], query?: TQuery) => RestCommand<UpdateFieldOutput<Schema, TQuery>[], Schema>;
//#endregion
export { UpdateFieldOutput, updateField, updateFields };
//# sourceMappingURL=fields.d.ts.map