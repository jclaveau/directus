import { DirectusRole } from "../../../schema/role.cjs";
import { ApplyQueryFields } from "../../../types/output.cjs";
import { Query } from "../../../types/query.cjs";
import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/read/roles.d.ts
type ReadRoleOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusRole<Schema>> = ApplyQueryFields<Schema, Item, TQuery['fields']>;
/**
 * List all Roles that exist in Directus.
 * @param query The query parameters
 * @returns An array of up to limit Role objects. If no items are available, data will be an empty array.
 */
declare const readRoles: <Schema, const TQuery extends Query<Schema, DirectusRole<Schema>>>(query?: TQuery) => RestCommand<ReadRoleOutput<Schema, TQuery>[], Schema>;
/**
 * List an existing Role by primary key.
 * @param key The primary key of the role
 * @param query The query parameters
 * @returns Returns a Role object if a valid primary key was provided.
 * @throws Will throw if key is empty
 */
declare const readRole: <Schema, const TQuery extends Query<Schema, DirectusRole<Schema>>>(key: DirectusRole<Schema>["id"], query?: TQuery) => RestCommand<ReadRoleOutput<Schema, TQuery>, Schema>;
/**
 * List the attached roles for the current user.
 * @param query The query parameters
 * @returns Returns Role objects
 * @throws Will throw if key is empty
 */
declare const readRolesMe: <Schema, const TQuery extends Query<Schema, DirectusRole<Schema>>>(query?: TQuery) => RestCommand<ReadRoleOutput<Schema, TQuery>[], Schema>;
//#endregion
export { ReadRoleOutput, readRole, readRoles, readRolesMe };
//# sourceMappingURL=roles.d.cts.map