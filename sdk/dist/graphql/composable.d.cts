import { DirectusClient } from "../types/client.cjs";
import { GraphqlClient, GraphqlConfig } from "./types.cjs";

//#region src/graphql/composable.d.ts

/**
 * Creates a client to communicate with Directus GraphQL.
 *
 * @returns A Directus GraphQL client.
 */
declare const graphql: (config?: Partial<GraphqlConfig>) => <Schema>(client: DirectusClient<Schema>) => GraphqlClient<Schema>;
//#endregion
export { graphql };
//# sourceMappingURL=composable.d.cts.map