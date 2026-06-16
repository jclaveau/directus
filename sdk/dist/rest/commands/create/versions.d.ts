import { DirectusVersion } from "../../../schema/version.js";
import { NestedPartial } from "../../../types/utils.js";
import { ApplyQueryFields } from "../../../types/output.js";
import { Query } from "../../../types/query.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/create/versions.d.ts
type CreateContentVersionOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusVersion<Schema>> = ApplyQueryFields<Schema, Item, TQuery["fields"]>;
/**
* Create multiple new Content Versions.
*
* @param items The Content Versions to create
* @param query Optional return data query
*
* @returns Returns the Content Version object for the created Content Versions.
*/
declare const createContentVersions: <Schema, const TQuery extends Query<Schema, DirectusVersion<Schema>>>(items: NestedPartial<DirectusVersion<Schema>>[], query?: TQuery) => RestCommand<CreateContentVersionOutput<Schema, TQuery>[], Schema>;
/**
* Create a new Content Version.
*
* @param item The Content Version to create
* @param query Optional return data query
*
* @returns Returns the Content Version object for the created Content Version.
*/
declare const createContentVersion: <Schema, const TQuery extends Query<Schema, DirectusVersion<Schema>>>(item: NestedPartial<DirectusVersion<Schema>>, query?: TQuery) => RestCommand<CreateContentVersionOutput<Schema, TQuery>, Schema>;
//#endregion
export { CreateContentVersionOutput, createContentVersion, createContentVersions };
//# sourceMappingURL=versions.d.ts.map