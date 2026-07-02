import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/server/graphql.d.ts

/**
 * Retrieve the GraphQL SDL for the current project.
 * @returns GraphQL SDL.
 */
declare const readGraphqlSdl: <Schema>(scope?: "item" | "system") => RestCommand<string, Schema>;
//#endregion
export { readGraphqlSdl };
//# sourceMappingURL=graphql.d.cts.map