import { DirectusUser } from "../../../schema/user.cjs";
import { ApplyQueryFields } from "../../../types/output.cjs";
import { Query } from "../../../types/query.cjs";
import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/read/users.d.ts
type ReadUserOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusUser<Schema>> = ApplyQueryFields<Schema, Item, TQuery['fields']>;
/**
 * List all users that exist in Directus.
 *
 * @param query The query parameters
 *
 * @returns An array of up to limit user objects. If no items are available, data will be an empty array.
 */
declare const readUsers: <Schema, const TQuery extends Query<Schema, DirectusUser<Schema>>>(query?: TQuery) => RestCommand<ReadUserOutput<Schema, TQuery>[], Schema>;
/**
 * List an existing user by primary key.
 *
 * @param key The primary key of the user
 * @param query The query parameters
 *
 * @returns Returns the requested user object.
 * @throws Will throw if key is empty
 */
declare const readUser: <Schema, const TQuery extends Query<Schema, DirectusUser<Schema>>>(key: DirectusUser<Schema>["id"], query?: TQuery) => RestCommand<ReadUserOutput<Schema, TQuery>, Schema>;
/**
 * Retrieve the currently authenticated user.
 *
 * @param query The query parameters
 *
 * @returns Returns the user object for the currently authenticated user.
 */
declare const readMe: <Schema, const TQuery extends Query<Schema, DirectusUser<Schema>>>(query?: TQuery) => RestCommand<ReadUserOutput<Schema, TQuery>, Schema>;
//#endregion
export { ReadUserOutput, readMe, readUser, readUsers };
//# sourceMappingURL=users.d.cts.map