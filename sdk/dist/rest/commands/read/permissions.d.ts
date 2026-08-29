import { DirectusPermission } from "../../../schema/permission.js";
import { AllCollections } from "../../../types/schema.js";
import { ApplyQueryFields } from "../../../types/output.js";
import { Query } from "../../../types/query.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/read/permissions.d.ts
type ReadPermissionOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusPermission<Schema>> = ApplyQueryFields<Schema, Item, TQuery['fields']>;
type ReadItemPermissionsOutput = {
  update: {
    access: boolean;
    presets?: Record<string, any> | null;
    fields?: string[] | null;
  };
  delete: {
    access: boolean;
  };
  share: {
    access: boolean;
  };
};
type ReadUserPermissionsOutput = Record<string, Record<'create' | 'update' | 'delete' | 'read' | 'share', {
  access: 'none' | 'partial' | 'full';
  fields?: string[];
  presets?: Record<string, any>;
}>>;
/**
 * List all Permissions that exist in Directus.
 * @param query The query parameters
 * @returns An array of up to limit Permission objects. If no items are available, data will be an empty array.
 */
declare const readPermissions: <Schema, const TQuery extends Query<Schema, DirectusPermission<Schema>>>(query?: TQuery) => RestCommand<ReadPermissionOutput<Schema, TQuery>[], Schema>;
/**
 * List all Permissions that exist in Directus.
 * @param key The primary key of the permission
 * @param query The query parameters
 * @returns Returns a Permission object if a valid primary key was provided.
 * @throws Will throw if key is empty
 */
declare const readPermission: <Schema, const TQuery extends Query<Schema, DirectusPermission<Schema>>>(key: DirectusPermission<Schema>["id"], query?: TQuery) => RestCommand<ReadPermissionOutput<Schema, TQuery>, Schema>;
/**
 * Check the current user's permissions on a specific item.
 * @param collection The collection of the item
 * @param key The primary key of the item
 * @returns Returns a ItemPermissions object if a valid collection / primary key was provided.
 */
declare const readItemPermissions: <Schema, Collection extends AllCollections<Schema>>(collection: Collection, key?: string | number) => RestCommand<ReadItemPermissionsOutput, Schema>;
/**
 * Check the current user's permissions.
 */
declare const readUserPermissions: <Schema>() => RestCommand<ReadUserPermissionsOutput, Schema>;
//#endregion
export { ReadItemPermissionsOutput, ReadPermissionOutput, ReadUserPermissionsOutput, readItemPermissions, readPermission, readPermissions, readUserPermissions };
//# sourceMappingURL=permissions.d.ts.map