import { DirectusCollection } from "../../../schema/collection.cjs";
import { NestedPartial } from "../../../types/utils.cjs";
import { ApplyQueryFields } from "../../../types/output.cjs";
import { FieldQuery, Query } from "../../../types/query.cjs";
import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/create/collections.d.ts
type CreateCollectionOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusCollection<Schema>> = ApplyQueryFields<Schema, Item, TQuery["fields"]>;
/**
* Create a new Collection. This will create a new table in the database as well.
*
* @param item This endpoint doesn't currently support any query parameters.
* @param query Optional return data query
*
* @returns The collection object for the collection created in this request.
*/
declare const createCollection: <Schema, const TQuery extends FieldQuery<Schema, DirectusCollection<Schema>>>(item: NestedPartial<DirectusCollection<Schema>>, query?: TQuery) => RestCommand<CreateCollectionOutput<Schema, TQuery>, Schema>;
//#endregion
export { CreateCollectionOutput, createCollection };
//# sourceMappingURL=collections.d.cts.map