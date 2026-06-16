import { DirectusOperation } from "../../../schema/operation.js";
import { NestedPartial } from "../../../types/utils.js";
import { ApplyQueryFields } from "../../../types/output.js";
import { Query } from "../../../types/query.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/create/operations.d.ts
type CreateOperationOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusOperation<Schema>> = ApplyQueryFields<Schema, Item, TQuery["fields"]>;
/**
* Create multiple new operations.
*
* @param items The operation to create
* @param query Optional return data query
*
* @returns Returns the operation object for the created operation.
*/
declare const createOperations: <Schema, const TQuery extends Query<Schema, DirectusOperation<Schema>>>(items: NestedPartial<DirectusOperation<Schema>>[], query?: TQuery) => RestCommand<CreateOperationOutput<Schema, TQuery>[], Schema>;
/**
* Create a new operation.
*
* @param item The operation to create
* @param query Optional return data query
*
* @returns Returns the operation object for the created operation.
*/
declare const createOperation: <Schema, const TQuery extends Query<Schema, DirectusOperation<Schema>>>(item: NestedPartial<DirectusOperation<Schema>>, query?: TQuery) => RestCommand<CreateOperationOutput<Schema, TQuery>, Schema>;
//#endregion
export { CreateOperationOutput, createOperation, createOperations };
//# sourceMappingURL=operations.d.ts.map