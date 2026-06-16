import { DirectusPermission } from "../../../schema/permission.js";
import { NestedPartial } from "../../../types/utils.js";
import { ApplyQueryFields } from "../../../types/output.js";
import { Query } from "../../../types/query.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/update/permissions.d.ts
type UpdatePermissionOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusPermission<Schema>> = ApplyQueryFields<Schema, Item, TQuery["fields"]>;
/**
* Update multiple existing permissions rules.
* @param keys
* @param item
* @param query
* @returns Returns the permission object for the updated permissions.
* @throws Will throw if keys is empty
*/
declare const updatePermissions: <Schema, const TQuery extends Query<Schema, DirectusPermission<Schema>>>(keys: DirectusPermission<Schema>["id"][], item: NestedPartial<DirectusPermission<Schema>>, query?: TQuery) => RestCommand<UpdatePermissionOutput<Schema, TQuery>[], Schema>;
/**
* Update multiple permissions rules as batch.
* @param items
* @param query
* @returns Returns the permission object for the updated permissions.
*/
declare const updatePermissionsBatch: <Schema, const TQuery extends Query<Schema, DirectusPermission<Schema>>>(items: NestedPartial<DirectusPermission<Schema>>[], query?: TQuery) => RestCommand<UpdatePermissionOutput<Schema, TQuery>[], Schema>;
/**
* Update an existing permissions rule.
* @param key
* @param item
* @param query
* @returns Returns the permission object for the updated permission.
* @throws Will throw if key is empty
*/
declare const updatePermission: <Schema, const TQuery extends Query<Schema, DirectusPermission<Schema>>>(key: DirectusPermission<Schema>["id"], item: NestedPartial<DirectusPermission<Schema>>, query?: TQuery) => RestCommand<UpdatePermissionOutput<Schema, TQuery>, Schema>;
//#endregion
export { UpdatePermissionOutput, updatePermission, updatePermissions, updatePermissionsBatch };
//# sourceMappingURL=permissions.d.ts.map