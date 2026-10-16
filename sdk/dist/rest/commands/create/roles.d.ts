import { DirectusRole } from "../../../schema/role.js";
import { NestedPartial } from "../../../types/utils.js";
import { ApplyQueryFields } from "../../../types/output.js";
import { Query } from "../../../types/query.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/create/roles.d.ts
type CreateRoleOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusRole<Schema>> = ApplyQueryFields<Schema, Item, TQuery['fields']>;
/**
 * Create multiple new roles.
 *
 * @param items The roles to create
 * @param query Optional return data query
 *
 * @returns Returns the role objects for the created roles.
 */
declare const createRoles: <Schema, const TQuery extends Query<Schema, DirectusRole<Schema>>>(items: NestedPartial<DirectusRole<Schema>>[], query?: TQuery) => RestCommand<CreateRoleOutput<Schema, TQuery>[], Schema>;
/**
 * Create a new role.
 *
 * @param item The role to create
 * @param query Optional return data query
 *
 * @returns Returns the role object for the created role.
 */
declare const createRole: <Schema, const TQuery extends Query<Schema, DirectusRole<Schema>>>(item: NestedPartial<DirectusRole<Schema>>, query?: TQuery) => RestCommand<CreateRoleOutput<Schema, TQuery>, Schema>;
//#endregion
export { CreateRoleOutput, createRole, createRoles };
//# sourceMappingURL=roles.d.ts.map