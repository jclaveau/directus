import { DirectusPolicy } from "../../../schema/policy.js";
import { ApplyQueryFields } from "../../../types/output.js";
import { Query } from "../../../types/query.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/read/policies.d.ts
type ReadPolicyOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusPolicy<Schema>> = ApplyQueryFields<Schema, Item, TQuery['fields']>;
type ReadPolicyGlobalsOutput = {
  app_access: boolean;
  admin_access: boolean;
  enforce_tfa: boolean;
};
/**
 * List all policies that exist in the project.
 * @param query The query parameters
 * @returns An array of up to limit Policy objects. If no items are available, data will be an empty array.
 */
declare const readPolicies: <Schema, const TQuery extends Query<Schema, DirectusPolicy<Schema>>>(query?: TQuery) => RestCommand<ReadPolicyOutput<Schema, TQuery>[], Schema>;
/**
 * Read a specific policy.
 * @param key The primary key of the permission
 * @param query The query parameters
 * @returns Returns a Policy object if a valid primary key was provided.
 * @throws Will throw if key is empty
 */
declare const readPolicy: <Schema, const TQuery extends Query<Schema, DirectusPolicy<Schema>>>(key: DirectusPolicy<Schema>["id"], query?: TQuery) => RestCommand<ReadPolicyOutput<Schema, TQuery>, Schema>;
/**
 * Check the current user's policy globals.
 */
declare const readPolicyGlobals: <Schema>() => RestCommand<ReadPolicyGlobalsOutput, Schema>;
//#endregion
export { ReadPolicyGlobalsOutput, ReadPolicyOutput, readPolicies, readPolicy, readPolicyGlobals };
//# sourceMappingURL=policies.d.ts.map