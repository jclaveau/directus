import { DirectusDeployment, DirectusDeploymentProject, DirectusDeploymentRun } from "../../../schema/deployment.js";
import { ApplyQueryFields } from "../../../types/output.js";
import { Query } from "../../../types/query.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/read/deployment.d.ts
type ReadDeploymentOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusDeployment<Schema>> = ApplyQueryFields<Schema, Item, TQuery["fields"]>;
type ReadDeploymentProjectOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusDeploymentProject<Schema>> = ApplyQueryFields<Schema, Item, TQuery["fields"]>;
type ReadDeploymentRunOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusDeploymentRun<Schema>> = ApplyQueryFields<Schema, Item, TQuery["fields"]>;
interface DeploymentProjectListOutput {
  id: string | null;
  external_id: string;
  name: string;
  deployable: boolean;
  framework?: string;
}
interface DeploymentDashboardOutput {
  projects: Array<{
    id: string;
    external_id: string;
    name: string;
    url?: string;
    framework?: string;
    deployable: boolean;
    latest_deployment?: {
      status: "building" | "ready" | "error" | "canceled";
      created_at: string;
      finished_at?: string;
    };
  }>;
  stats: {
    active_deployments: number;
    successful_builds: number;
    failed_builds: number;
  };
}
interface DeploymentRunStatsOutput {
  total_deployments: number;
  average_build_time: number | null;
  failed_builds: number;
  successful_builds: number;
}
interface DeploymentRunsOutput {
  id: string;
  project: string;
  external_id: string;
  name?: string;
  target: string;
  status: "building" | "ready" | "error" | "canceled";
  url?: string;
  started_at: string | null;
  completed_at: string | null;
  date_created: string;
  user_created: Record<string, any> | string | null;
}
/**
* List all configured deployment providers.
* @param query The query parameters
* @returns An array of deployment objects.
*/
declare const readDeployments: <Schema, const TQuery extends Query<Schema, DirectusDeployment<Schema>>>(query?: TQuery) => RestCommand<ReadDeploymentOutput<Schema, TQuery>[], Schema>;
/**
* Get a deployment provider by type.
* @param provider The provider type (e.g. 'vercel')
* @param query The query parameters
* @returns The deployment object.
* @throws Will throw if provider is empty
*/
declare const readDeployment: <Schema, const TQuery extends Query<Schema, DirectusDeployment<Schema>>>(provider: string, query?: TQuery) => RestCommand<ReadDeploymentOutput<Schema, TQuery>, Schema>;
/**
* Get deployment dashboard for a provider.
* Returns selected projects with latest deployment status and stats.
* @param provider The provider type (e.g. 'vercel')
* @returns Dashboard data with projects and stats.
* @throws Will throw if provider is empty
*/
declare const readDeploymentDashboard: <Schema>(provider: string, query?: {
  range?: string;
}) => RestCommand<DeploymentDashboardOutput, Schema>;
/**
* List projects for a deployment provider.
* Returns merged DB + provider info (id is null if project not selected).
* @param provider The provider type (e.g. 'vercel')
* @returns An array of project objects with selection status.
* @throws Will throw if provider is empty
*/
declare const readDeploymentProjects: <Schema>(provider: string) => RestCommand<DeploymentProjectListOutput[], Schema>;
/**
* Get a specific project from a deployment provider.
* @param provider The provider type (e.g. 'vercel')
* @param projectId The project ID
* @param query The query parameters
* @returns The project object.
* @throws Will throw if provider or projectId is empty
*/
declare const readDeploymentProject: <Schema, const TQuery extends Query<Schema, DirectusDeploymentProject<Schema>>>(provider: string, projectId: string, query?: TQuery) => RestCommand<ReadDeploymentProjectOutput<Schema, TQuery>, Schema>;
/**
* List deployment runs for a project.
* @param provider The provider type (e.g. 'vercel')
* @param projectId The project ID
* @param query Optional query parameters (search, limit, offset, meta)
* @returns Deployment runs with optional meta for pagination.
* @throws Will throw if provider or projectId is empty
*/
declare const readDeploymentRuns: <Schema>(provider: string, projectId: string, query?: {
  search?: string;
  limit?: number;
  offset?: number;
  meta?: string;
}) => RestCommand<DeploymentRunsOutput[], Schema>;
/**
* Get a specific deployment run with logs.
* @param provider The provider type (e.g. 'vercel')
* @param runId The run ID
* @param query The query parameters (supports 'since' for incremental logs)
* @returns The deployment run object with details and logs.
* @throws Will throw if provider or runId is empty
*/
declare const readDeploymentRun: <Schema, const TQuery extends Query<Schema, DirectusDeploymentRun<Schema>>>(provider: string, runId: string, query?: TQuery) => RestCommand<ReadDeploymentRunOutput<Schema, TQuery>, Schema>;
/**
* Get stats for a project's deployment runs.
* @param provider The provider type (e.g. 'vercel')
* @param projectId The project ID
* @param query Optional query parameters (range for time window, e.g. '24h', '7d', '30d')
* @returns Stats with total deployments and average build time.
* @throws Will throw if provider or projectId is empty
*/
declare const readDeploymentRunStats: <Schema>(provider: string, projectId: string, query?: {
  range?: string;
}) => RestCommand<DeploymentRunStatsOutput, Schema>;
//#endregion
export { DeploymentDashboardOutput, DeploymentProjectListOutput, DeploymentRunStatsOutput, DeploymentRunsOutput, ReadDeploymentOutput, ReadDeploymentProjectOutput, ReadDeploymentRunOutput, readDeployment, readDeploymentDashboard, readDeploymentProject, readDeploymentProjects, readDeploymentRun, readDeploymentRunStats, readDeploymentRuns, readDeployments };
//# sourceMappingURL=deployment.d.ts.map