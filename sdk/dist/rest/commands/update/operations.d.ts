import { DirectusOperation } from "../../../schema/operation.js";
import { NestedPartial } from "../../../types/utils.js";
import { ApplyQueryFields } from "../../../types/output.js";
import { Query } from "../../../types/query.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/update/operations.d.ts
type UpdateOperationOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusOperation<Schema>> = ApplyQueryFields<Schema, Item, TQuery["fields"]>;
/**
* Update multiple existing operations.
* @param keys
* @param item
* @param query
* @returns Returns the operation objects for the updated operations.
* @throws Will throw if keys is empty
*/
declare const updateOperations: <Schema, const TQuery extends Query<Schema, DirectusOperation<Schema>>>(keys: DirectusOperation<Schema>["id"][], item: NestedPartial<DirectusOperation<Schema>>, query?: TQuery) => RestCommand<UpdateOperationOutput<Schema, TQuery>[], Schema>;
/**
* Update multiple operations as batch.
* @param items
* @param query
* @returns Returns the operation objects for the updated operations.
*/
declare const updateOperationsBatch: <Schema, const TQuery extends Query<Schema, DirectusOperation<Schema>>>(items: NestedPartial<DirectusOperation<Schema>>[], query?: TQuery) => RestCommand<UpdateOperationOutput<Schema, TQuery>[], Schema>;
/**
* Update an existing operation.
* @param key
* @param item
* @param query
* @returns Returns the operation object for the updated operation.
* @throws Will throw if key is empty
*/
declare const updateOperation: <Schema, const TQuery extends Query<Schema, DirectusOperation<Schema>>>(key: DirectusOperation<Schema>["id"], item: NestedPartial<DirectusOperation<Schema>>, query?: TQuery) => RestCommand<UpdateOperationOutput<Schema, TQuery>, Schema>;
//#endregion
export { UpdateOperationOutput, updateOperation, updateOperations, updateOperationsBatch };
//# sourceMappingURL=operations.d.ts.map