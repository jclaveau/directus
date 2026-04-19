import { DirectusPolicy } from "../../../schema/policy.cjs";
import { NestedPartial } from "../../../types/utils.cjs";
import { ApplyQueryFields } from "../../../types/output.cjs";
import { Query } from "../../../types/query.cjs";
import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/create/policies.d.ts
type CreatePolicyOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusPolicy<Schema>> = ApplyQueryFields<Schema, Item, TQuery["fields"]>;
/**
* Create multiple new policies
*
* @param items The policies to create
* @param query Optional return data query
*
* @returns Returns the policy objects for the created policies.
*/
declare const createPolicies: <Schema, const TQuery extends Query<Schema, DirectusPolicy<Schema>>>(items: NestedPartial<DirectusPolicy<Schema>>[], query?: TQuery) => RestCommand<CreatePolicyOutput<Schema, TQuery>[], Schema>;
/**
* Create a new policy
*
* @param item The policy to create
* @param query Optional return data query
*
* @returns Returns the policy object for the created policy.
*/
declare const createPolicy: <Schema, const TQuery extends Query<Schema, DirectusPolicy<Schema>>>(item: NestedPartial<DirectusPolicy<Schema>>, query?: TQuery) => RestCommand<CreatePolicyOutput<Schema, TQuery>, Schema>;
//#endregion
export { CreatePolicyOutput, createPolicies, createPolicy };
//# sourceMappingURL=policies.d.cts.map