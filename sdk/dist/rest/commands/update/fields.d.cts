import { DirectusField } from "../../../schema/field.cjs";
import { NestedPartial } from "../../../types/utils.cjs";
import { ApplyQueryFields } from "../../../types/output.cjs";
import { Query } from "../../../types/query.cjs";
import { RestCommand } from "../../types.cjs";

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
declare const updateField: <Schema, const TQuery extends Query<Schema, DirectusField<Schema>>>(collection: DirectusField<Schema>["collection"], field: DirectusField<Schema>["field"], item: NestedPartial<DirectusField<Schema>>, query?: TQuery) => RestCommand<UpdateFieldOutput<Schema, TQuery>, Schema>;
//#endregion
export { UpdateFieldOutput, updateField };
//# sourceMappingURL=fields.d.cts.map