import { DirectusUser } from "../../../schema/user.cjs";
import { NestedPartial } from "../../../types/utils.cjs";
import { ApplyQueryFields } from "../../../types/output.cjs";
import { Query } from "../../../types/query.cjs";
import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/create/users.d.ts
type CreateUserOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusUser<Schema>> = ApplyQueryFields<Schema, Item, TQuery["fields"]>;
/**
* Create multiple new users.
*
* @param items The items to create
* @param query Optional return data query
*
* @returns Returns the user objects for the created users.
*/
declare const createUsers: <Schema, const TQuery extends Query<Schema, DirectusUser<Schema>>>(items: NestedPartial<DirectusUser<Schema>>[], query?: TQuery) => RestCommand<CreateUserOutput<Schema, TQuery>[], Schema>;
/**
* Create a new user.
*
* @param item The user to create
* @param query Optional return data query
*
* @returns Returns the user object for the created user.
*/
declare const createUser: <Schema, const TQuery extends Query<Schema, DirectusUser<Schema>>>(item: NestedPartial<DirectusUser<Schema>>, query?: TQuery) => RestCommand<CreateUserOutput<Schema, TQuery>, Schema>;
//#endregion
export { CreateUserOutput, createUser, createUsers };
//# sourceMappingURL=users.d.cts.map