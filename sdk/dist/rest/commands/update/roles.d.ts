import { DirectusRole } from "../../../schema/role.js";
import { NestedPartial } from "../../../types/utils.js";
import { ApplyQueryFields } from "../../../types/output.js";
import { Query } from "../../../types/query.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/update/roles.d.ts
type UpdateRoleOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusRole<Schema>> = ApplyQueryFields<Schema, Item, TQuery['fields']>;
/**
 * Update multiple existing roles.
 * @param keys
 * @param item
 * @param query
 * @returns Returns the role objects for the updated roles.
 * @throws Will throw if keys is empty
 */
declare const updateRoles: <Schema, const TQuery extends Query<Schema, DirectusRole<Schema>>>(keys: DirectusRole<Schema>["id"][], item: NestedPartial<DirectusRole<Schema>>, query?: TQuery) => RestCommand<UpdateRoleOutput<Schema, TQuery>[], Schema>;
/**
 * Update multiple roles as batch.
 * @param items
 * @param query
 * @returns Returns the role objects for the updated roles.
 */
declare const updateRolesBatch: <Schema, const TQuery extends Query<Schema, DirectusRole<Schema>>>(items: NestedPartial<DirectusRole<Schema>>[], query?: TQuery) => RestCommand<UpdateRoleOutput<Schema, TQuery>[], Schema>;
/**
 * Update an existing role.
 * @param key
 * @param item
 * @param query
 * @returns Returns the role object for the updated role.
 * @throws Will throw if key is empty
 */
declare const updateRole: <Schema, const TQuery extends Query<Schema, DirectusRole<Schema>>>(key: DirectusRole<Schema>["id"], item: NestedPartial<DirectusRole<Schema>>, query?: TQuery) => RestCommand<UpdateRoleOutput<Schema, TQuery>, Schema>;
//#endregion
export { UpdateRoleOutput, updateRole, updateRoles, updateRolesBatch };
//# sourceMappingURL=roles.d.ts.map