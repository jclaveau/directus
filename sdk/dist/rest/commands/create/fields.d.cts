import { DirectusField } from "../../../schema/field.cjs";
import { NestedPartial } from "../../../types/utils.cjs";
import { ApplyQueryFields } from "../../../types/output.cjs";
import { FieldQuery, Query } from "../../../types/query.cjs";
import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/create/fields.d.ts
type CreateFieldOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusField<Schema>> = ApplyQueryFields<Schema, Item, TQuery["fields"]>;
/**
* Create a new field in the given collection.
*
* @param collection The collection to create a field for
* @param item The field to create
* @param query Optional return data query
*
* @returns The field object for the created field.
*/
declare const createField: <Schema, const TQuery extends FieldQuery<Schema, DirectusField<Schema>>>(collection: keyof Schema, item: NestedPartial<DirectusField<Schema>>, query?: TQuery) => RestCommand<CreateFieldOutput<Schema, TQuery>, Schema>;
//#endregion
export { CreateFieldOutput, createField };
//# sourceMappingURL=fields.d.cts.map