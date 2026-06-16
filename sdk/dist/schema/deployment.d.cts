import { DirectusUser } from "./user.cjs";
import { MergeCoreCollection } from "../types/schema.cjs";

//#region src/schema/deployment.d.ts

/**
* Directus Deployment configuration
*/
type DirectusDeployment<Schema = any> = MergeCoreCollection<Schema, "directus_deployments", {
  id: string;
  provider: string;
  credentials: Record<string, any>;
  options: Record<string, any> | null;
  date_created: "datetime" | null;
  user_created: DirectusUser<Schema> | string | null;
  projects: DirectusDeploymentProject<Schema>[] | string[];
}>;
/**
* Directus Deployment Project
*/
type DirectusDeploymentProject<Schema = any> = MergeCoreCollection<Schema, "directus_deployment_projects", {
  id: string;
  deployment: DirectusDeployment<Schema> | string;
  external_id: string;
  name: string;
  date_created: "datetime" | null;
  user_created: DirectusUser<Schema> | string | null;
}>;
/**
* Directus Deployment Run
*/
type DirectusDeploymentRun<Schema = any> = MergeCoreCollection<Schema, "directus_deployment_runs", {
  id: string;
  project: DirectusDeploymentProject<Schema> | string;
  external_id: string;
  status: "building" | "ready" | "error" | "canceled";
  target: string;
  url: string | null;
  started_at: "datetime" | null;
  completed_at: "datetime" | null;
  date_created: "datetime" | null;
  user_created: DirectusUser<Schema> | string | null;
  logs?: {
    timestamp: Date | string;
    type: "stdout" | "stderr" | "info";
    message: string;
  }[];
}>;
//#endregion
export { DirectusDeployment, DirectusDeploymentProject, DirectusDeploymentRun };
//# sourceMappingURL=deployment.d.cts.map