import { DirectusField } from "../../../schema/field.js";
import { NestedPartial } from "../../../types/utils.js";
import { ApplyQueryFields } from "../../../types/output.js";
import { FieldQuery, Query } from "../../../types/query.js";
import { RestCommand } from "../../types.js";

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
//# sourceMappingURL=fields.d.ts.map