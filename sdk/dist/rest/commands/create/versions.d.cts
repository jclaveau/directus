import { DirectusVersion } from "../../../schema/version.cjs";
import { NestedPartial } from "../../../types/utils.cjs";
import { ApplyQueryFields } from "../../../types/output.cjs";
import { Query } from "../../../types/query.cjs";
import { RestCommand } from "../../types.cjs";

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
//# sourceMappingURL=versions.d.cts.map