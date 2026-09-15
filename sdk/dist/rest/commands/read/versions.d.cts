import { DirectusVersion } from "../../../schema/version.cjs";
import { ApplyQueryFields } from "../../../types/output.cjs";
import { Query } from "../../../types/query.cjs";
import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/read/versions.d.ts
type ReadContentVersionOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusVersion<Schema>> = ApplyQueryFields<Schema, Item, TQuery['fields']>;
/**
 * List all Content Versions that exist in Directus.
 * @param query The query parameters
 * @returns An array of up to limit Content Version objects. If no items are available, data will be an empty array.
 */
declare const readContentVersions: <Schema, const TQuery extends Query<Schema, DirectusVersion<Schema>>>(query?: TQuery) => RestCommand<ReadContentVersionOutput<Schema, TQuery>[], Schema>;
/**
 * List an existing COntent Version by primary key.
 * @param key The primary key of the Content Version
 * @param query The query parameters
 * @returns Returns a Content Version object if a valid primary key was provided.
 * @throws Will throw if key is empty
 */
declare const readContentVersion: <Schema, const TQuery extends Query<Schema, DirectusVersion<Schema>>>(key: DirectusVersion<Schema>["id"], query?: TQuery) => RestCommand<ReadContentVersionOutput<Schema, TQuery>, Schema>;
//#endregion
export { ReadContentVersionOutput, readContentVersion, readContentVersions };
//# sourceMappingURL=versions.d.cts.map