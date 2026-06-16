import { DirectusVersion } from "../../../schema/version.js";
import { NestedPartial } from "../../../types/utils.js";
import { ApplyQueryFields } from "../../../types/output.js";
import { Query } from "../../../types/query.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/update/versions.d.ts
type UpdateContentVersionOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusVersion<Schema>> = ApplyQueryFields<Schema, Item, TQuery["fields"]>;
/**
* Update multiple existing Content Versions.
* @param keys
* @param item
* @param query
* @returns Returns the Content Version objects for the updated Content Versions.
* @throws Will throw if keys is empty
*/
declare const updateContentVersions: <Schema, const TQuery extends Query<Schema, DirectusVersion<Schema>>>(keys: DirectusVersion<Schema>["id"][], item: NestedPartial<DirectusVersion<Schema>>, query?: TQuery) => RestCommand<UpdateContentVersionOutput<Schema, TQuery>[], Schema>;
/**
* Update multiple Content Versions as batch.
* @param items
* @param query
* @returns Returns the Content Version objects for the updated Content Versions.
*/
declare const updateContentVersionsBatch: <Schema, const TQuery extends Query<Schema, DirectusVersion<Schema>>>(items: NestedPartial<DirectusVersion<Schema>>[], query?: TQuery) => RestCommand<UpdateContentVersionOutput<Schema, TQuery>[], Schema>;
/**
* Update an existing Content Version.
* @param key
* @param item
* @param query
* @returns Returns the Content Version object for the updated Content Version.
* @throws Will throw if key is empty
*/
declare const updateContentVersion: <Schema, const TQuery extends Query<Schema, DirectusVersion<Schema>>>(key: DirectusVersion<Schema>["id"], item: NestedPartial<DirectusVersion<Schema>>, query?: TQuery) => RestCommand<UpdateContentVersionOutput<Schema, TQuery>, Schema>;
//#endregion
export { UpdateContentVersionOutput, updateContentVersion, updateContentVersions, updateContentVersionsBatch };
//# sourceMappingURL=versions.d.ts.map