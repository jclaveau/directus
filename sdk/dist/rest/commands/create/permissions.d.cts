import { DirectusPermission } from "../../../schema/permission.cjs";
import { NestedPartial } from "../../../types/utils.cjs";
import { ApplyQueryFields } from "../../../types/output.cjs";
import { Query } from "../../../types/query.cjs";
import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/create/permissions.d.ts
type CreatePermissionOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusPermission<Schema>> = ApplyQueryFields<Schema, Item, TQuery["fields"]>;
/**
* Create multiple new permission rules
*
* @param items The permission rules to create
* @param query Optional return data query
*
* @returns Returns the permission objects for the created permissions.
*/
declare const createPermissions: <Schema, const TQuery extends Query<Schema, DirectusPermission<Schema>>>(items: NestedPartial<DirectusPermission<Schema>>[], query?: TQuery) => RestCommand<CreatePermissionOutput<Schema, TQuery>[], Schema>;
/**
* Create a new permission rule
*
* @param item The permission rule to create
* @param query Optional return data query
*
* @returns Returns the permission object for the created permission.
*/
declare const createPermission: <Schema, const TQuery extends Query<Schema, DirectusPermission<Schema>>>(item: NestedPartial<DirectusPermission<Schema>>, query?: TQuery) => RestCommand<CreatePermissionOutput<Schema, TQuery>, Schema>;
//#endregion
export { CreatePermissionOutput, createPermission, createPermissions };
//# sourceMappingURL=permissions.d.cts.map