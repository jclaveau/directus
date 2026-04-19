import { DirectusDeployment } from "../../../schema/deployment.js";
import { NestedPartial } from "../../../types/utils.js";
import { ApplyQueryFields } from "../../../types/output.js";
import { Query } from "../../../types/query.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/create/deployment.d.ts
type CreateDeploymentOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusDeployment<Schema>> = ApplyQueryFields<Schema, Item, TQuery["fields"]>;
/**
* Create a new deployment provider.
*
* @param item The deployment to create
* @param query Optional return data query
*
* @returns Returns the created deployment object.
*/
declare const createDeployment: <Schema, const TQuery extends Query<Schema, DirectusDeployment<Schema>>>(item: NestedPartial<DirectusDeployment<Schema>>, query?: TQuery) => RestCommand<CreateDeploymentOutput<Schema, TQuery>, Schema>;
//#endregion
export { CreateDeploymentOutput, createDeployment };
//# sourceMappingURL=deployment.d.ts.map