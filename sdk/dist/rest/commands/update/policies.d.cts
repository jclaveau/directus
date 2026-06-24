import { DirectusPolicy } from "../../../schema/policy.cjs";
import { NestedPartial } from "../../../types/utils.cjs";
import { ApplyQueryFields } from "../../../types/output.cjs";
import { Query } from "../../../types/query.cjs";
import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/update/policies.d.ts
type UpdatePolicyOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusPolicy<Schema>> = ApplyQueryFields<Schema, Item, TQuery["fields"]>;
/**
* Update multiple existing policies.
* @param keys
* @param item
* @param query
* @returns Returns the policies objects for the updated policies.
* @throws Will throw if keys is empty
*/
declare const updatePolicies: <Schema, const TQuery extends Query<Schema, DirectusPolicy<Schema>>>(keys: DirectusPolicy<Schema>["id"][], item: NestedPartial<DirectusPolicy<Schema>>, query?: TQuery) => RestCommand<UpdatePolicyOutput<Schema, TQuery>[], Schema>;
/**
* Update multiple policies as batch.
* @param items
* @param query
* @returns Returns the policies object for the updated policies.
*/
declare const updatePoliciesBatch: <Schema, const TQuery extends Query<Schema, DirectusPolicy<Schema>>>(items: NestedPartial<DirectusPolicy<Schema>>[], query?: TQuery) => RestCommand<UpdatePolicyOutput<Schema, TQuery>[], Schema>;
/**
* Update an existing policy.
* @param key
* @param item
* @param query
* @returns Returns the policy object for the updated policy.
* @throws Will throw if key is empty
*/
declare const updatePolicy: <Schema, const TQuery extends Query<Schema, DirectusPolicy<Schema>>>(key: DirectusPolicy<Schema>["id"], item: NestedPartial<DirectusPolicy<Schema>>, query?: TQuery) => RestCommand<UpdatePolicyOutput<Schema, TQuery>, Schema>;
//#endregion
export { UpdatePolicyOutput, updatePolicies, updatePoliciesBatch, updatePolicy };
//# sourceMappingURL=policies.d.cts.map