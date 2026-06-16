import { DirectusShare } from "../../../schema/share.cjs";
import { NestedPartial } from "../../../types/utils.cjs";
import { ApplyQueryFields } from "../../../types/output.cjs";
import { Query } from "../../../types/query.cjs";
import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/update/shares.d.ts
type UpdateShareOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusShare<Schema>> = ApplyQueryFields<Schema, Item, TQuery["fields"]>;
/**
* Update multiple existing shares.
* @param keys
* @param item
* @param query
* @returns Returns the share objects for the updated shares.
* @throws Will throw if keys is empty
*/
declare const updateShares: <Schema, const TQuery extends Query<Schema, DirectusShare<Schema>>>(keys: DirectusShare<Schema>["id"][], item: NestedPartial<DirectusShare<Schema>>, query?: TQuery) => RestCommand<UpdateShareOutput<Schema, TQuery>[], Schema>;
/**
* Update multiple shares as batch.
* @param items
* @param query
* @returns Returns the share objects for the updated shares.
*/
declare const updateSharesBatch: <Schema, const TQuery extends Query<Schema, DirectusShare<Schema>>>(items: NestedPartial<DirectusShare<Schema>>[], query?: TQuery) => RestCommand<UpdateShareOutput<Schema, TQuery>[], Schema>;
/**
* Update an existing share.
* @param key
* @param item
* @param query
* @returns Returns the share object for the updated share.
* @throws Will throw if key is empty
*/
declare const updateShare: <Schema, const TQuery extends Query<Schema, DirectusShare<Schema>>>(key: DirectusShare<Schema>["id"], item: NestedPartial<DirectusShare<Schema>>, query?: TQuery) => RestCommand<UpdateShareOutput<Schema, TQuery>, Schema>;
//#endregion
export { UpdateShareOutput, updateShare, updateShares, updateSharesBatch };
//# sourceMappingURL=shares.d.cts.map