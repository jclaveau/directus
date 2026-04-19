import { DirectusDeployment, DirectusDeploymentProject } from "../../../schema/deployment.js";
import { NestedPartial } from "../../../types/utils.js";
import { ApplyQueryFields } from "../../../types/output.js";
import { Query } from "../../../types/query.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/update/deployment.d.ts
type UpdateDeploymentOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusDeployment<Schema>> = ApplyQueryFields<Schema, Item, TQuery["fields"]>;
/**
* Update an existing deployment provider.
*
* @param provider The provider type (e.g. 'vercel')
* @param item The deployment fields to update
* @param query Optional return data query
*
* @returns Returns the updated deployment object.
* @throws Will throw if provider is empty
*/
declare const updateDeployment: <Schema, const TQuery extends Query<Schema, DirectusDeployment<Schema>>>(provider: string, item: NestedPartial<DirectusDeployment<Schema>>, query?: TQuery) => RestCommand<UpdateDeploymentOutput<Schema, TQuery>, Schema>;
interface UpdateDeploymentProjectsInput {
  create?: Array<{
    external_id: string;
    name: string;
  }>;
  delete?: string[];
}
/**
* Update selected projects for a deployment provider.
*
* @param provider The provider type (e.g. 'vercel')
* @param item Projects to create or delete
*
* @returns Returns the updated list of selected projects.
* @throws Will throw if provider is empty
*/
declare const updateDeploymentProjects: <Schema>(provider: string, item: UpdateDeploymentProjectsInput) => RestCommand<DirectusDeploymentProject<Schema>[], Schema>;
//#endregion
export { UpdateDeploymentOutput, UpdateDeploymentProjectsInput, updateDeployment, updateDeploymentProjects };
//# sourceMappingURL=deployment.d.ts.map