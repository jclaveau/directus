import { DirectusShare } from "../../../schema/share.cjs";
import { ApplyQueryFields } from "../../../types/output.cjs";
import { Query } from "../../../types/query.cjs";
import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/read/shares.d.ts
type ReadShareOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusShare<Schema>> = ApplyQueryFields<Schema, Item, TQuery['fields']>;
/**
 * List all Shares that exist in Directus.
 * @param query The query parameters
 * @returns An array of up to limit Share objects. If no items are available, data will be an empty array.
 */
declare const readShares: <Schema, const TQuery extends Query<Schema, DirectusShare<Schema>>>(query?: TQuery) => RestCommand<ReadShareOutput<Schema, TQuery>[], Schema>;
/**
 * List an existing Share by primary key.
 * @param key The primary key of the dashboard
 * @param query The query parameters
 * @returns Returns a Share object if a valid primary key was provided.
 * @throws Will throw if key is empty
 */
declare const readShare: <Schema, TQuery extends Query<Schema, DirectusShare<Schema>>>(key: DirectusShare<Schema>["id"], query?: TQuery) => RestCommand<ReadShareOutput<Schema, TQuery>, Schema>;
//#endregion
export { ReadShareOutput, readShare, readShares };
//# sourceMappingURL=shares.d.cts.map