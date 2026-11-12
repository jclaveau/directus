import { DirectusOperation } from "../../../schema/operation.js";
import { ApplyQueryFields } from "../../../types/output.js";
import { Query } from "../../../types/query.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/read/operations.d.ts
type ReadOperationOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusOperation<Schema>> = ApplyQueryFields<Schema, Item, TQuery['fields']>;
/**
 * List all operations that exist in Directus.
 * @param query The query parameters
 * @returns An array of up to limit operation objects. If no items are available, data will be an empty array.
 */
declare const readOperations: <Schema, const TQuery extends Query<Schema, DirectusOperation<Schema>>>(query?: TQuery) => RestCommand<ReadOperationOutput<Schema, TQuery>[], Schema>;
/**
 * List all Operations that exist in Directus.
 * @param key The primary key of the dashboard
 * @param query The query parameters
 * @returns Returns a Operation object if a valid primary key was provided.
 * @throws Will throw if key is empty
 */
declare const readOperation: <Schema, const TQuery extends Query<Schema, DirectusOperation<Schema>>>(key: DirectusOperation<Schema>["id"], query?: TQuery) => RestCommand<ReadOperationOutput<Schema, TQuery>, Schema>;
//#endregion
export { ReadOperationOutput, readOperation, readOperations };
//# sourceMappingURL=operations.d.ts.map