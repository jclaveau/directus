import { DirectusShare } from "../../../schema/share.js";
import { NestedPartial } from "../../../types/utils.js";
import { ApplyQueryFields } from "../../../types/output.js";
import { Query } from "../../../types/query.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/create/shares.d.ts
type CreateShareOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusShare<Schema>> = ApplyQueryFields<Schema, Item, TQuery["fields"]>;
/**
* Create multiple new shares.
*
* @param items The shares to create
* @param query Optional return data query
*
* @returns Returns the share objects for the created shares.
*/
declare const createShares: <Schema, const TQuery extends Query<Schema, DirectusShare<Schema>>>(items: NestedPartial<DirectusShare<Schema>>[], query?: TQuery) => RestCommand<CreateShareOutput<Schema, TQuery>[], Schema>;
/**
* Create a new share.
*
* @param item The share to create
* @param query Optional return data query
*
* @returns Returns the share object for the created share.
*/
declare const createShare: <Schema, const TQuery extends Query<Schema, DirectusShare<Schema>>>(item: NestedPartial<DirectusShare<Schema>>, query?: TQuery) => RestCommand<CreateShareOutput<Schema, TQuery>, Schema>;
//#endregion
export { CreateShareOutput, createShare, createShares };
//# sourceMappingURL=shares.d.ts.map