import { DirectusUser } from "../../../schema/user.js";
import { NestedPartial } from "../../../types/utils.js";
import { ApplyQueryFields } from "../../../types/output.js";
import { Query } from "../../../types/query.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/update/users.d.ts
type UpdateUserOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusUser<Schema>> = ApplyQueryFields<Schema, Item, TQuery["fields"]>;
/**
* Update multiple existing users.
*
* @param keys The primary key of the users
* @param item The user data to update
* @param query Optional return data query
*
* @returns Returns the user objects for the updated users.
* @throws Will throw if keys is empty
*/
declare const updateUsers: <Schema, const TQuery extends Query<Schema, DirectusUser<Schema>>>(keys: DirectusUser<Schema>["id"][], item: NestedPartial<DirectusUser<Schema>>, query?: TQuery) => RestCommand<UpdateUserOutput<Schema, TQuery>[], Schema>;
/**
* Update multiple users as batch.
*
* @param items The user data to update
* @param query Optional return data query
*
* @returns Returns the user objects for the updated users.
*/
declare const updateUsersBatch: <Schema, const TQuery extends Query<Schema, DirectusUser<Schema>>>(items: NestedPartial<DirectusUser<Schema>>[], query?: TQuery) => RestCommand<UpdateUserOutput<Schema, TQuery>[], Schema>;
/**
* Update an existing user.
*
* @param key The primary key of the user
* @param item The user data to update
* @param query Optional return data query
*
* @returns Returns the user object for the updated user.
* @throws Will throw if key is empty
*/
declare const updateUser: <Schema, const TQuery extends Query<Schema, DirectusUser<Schema>>>(key: DirectusUser<Schema>["id"], item: NestedPartial<DirectusUser<Schema>>, query?: TQuery) => RestCommand<UpdateUserOutput<Schema, TQuery>, Schema>;
/**
* Update the authenticated user.
*
* @param item The user data to update
* @param query Optional return data query
*
* @returns Returns the updated user object for the authenticated user.
*/
declare const updateMe: <Schema, const TQuery extends Query<Schema, DirectusUser<Schema>>>(item: NestedPartial<DirectusUser<Schema>>, query?: TQuery) => RestCommand<UpdateUserOutput<Schema, TQuery>, Schema>;
//#endregion
export { UpdateUserOutput, updateMe, updateUser, updateUsers, updateUsersBatch };
//# sourceMappingURL=users.d.ts.map