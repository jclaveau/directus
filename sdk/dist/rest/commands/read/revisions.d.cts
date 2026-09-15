import { DirectusRevision } from "../../../schema/revision.cjs";
import { ApplyQueryFields } from "../../../types/output.cjs";
import { Query } from "../../../types/query.cjs";
import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/read/revisions.d.ts
type ReadRevisionOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusRevision<Schema>> = ApplyQueryFields<Schema, Item, TQuery['fields']>;
/**
 * List all Revisions that exist in Directus.
 * @param query The query parameters
 * @returns An array of up to limit Revision objects. If no items are available, data will be an empty array.
 */
declare const readRevisions: <Schema, const TQuery extends Query<Schema, DirectusRevision<Schema>>>(query?: TQuery) => RestCommand<ReadRevisionOutput<Schema, TQuery>[], Schema>;
/**
 * List an existing Revision by primary key.
 * @param key The primary key of the dashboard
 * @param query The query parameters
 * @returns Returns a Revision object if a valid primary key was provided.
 * @throws Will throw if key is empty
 */
declare const readRevision: <Schema, const TQuery extends Query<Schema, DirectusRevision<Schema>>>(key: DirectusRevision<Schema>["id"], query?: TQuery) => RestCommand<ReadRevisionOutput<Schema, TQuery>, Schema>;
//#endregion
export { ReadRevisionOutput, readRevision, readRevisions };
//# sourceMappingURL=revisions.d.cts.map