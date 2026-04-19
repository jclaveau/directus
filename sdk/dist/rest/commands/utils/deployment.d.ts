import { RestCommand } from "../../types.js";

//#region src/rest/commands/utils/deployment.d.ts
interface TriggerDeploymentResult {
  id: string;
  external_id: string;
  project: string;
  target: string;
  status: "building" | "ready" | "error" | "canceled";
  url?: string;
  date_created: string;
}
interface TriggerDeploymentOptions {
  preview?: boolean;
  clear_cache?: boolean;
}
/**
* Trigger a new deployment for a project.
*
* @param provider The provider type (e.g. 'vercel')
* @param projectId The project ID to deploy
* @param options Deployment options (preview, clear_cache)
*
* @returns The deployment trigger result with deployment ID and status.
* @throws Will throw if provider or projectId is empty
*/
declare const triggerDeployment: <Schema>(provider: string, projectId: string, options?: TriggerDeploymentOptions) => RestCommand<TriggerDeploymentResult, Schema>;
/**
* Cancel a deployment run.
*
* @param provider The provider type (e.g. 'vercel')
* @param runId The run ID to cancel
*
* @returns The updated run object.
* @throws Will throw if provider or runId is empty
*/
declare const cancelDeployment: <Schema>(provider: string, runId: string) => RestCommand<TriggerDeploymentResult, Schema>;
//#endregion
export { TriggerDeploymentOptions, TriggerDeploymentResult, cancelDeployment, triggerDeployment };
//# sourceMappingURL=deployment.d.ts.map