import { DirectusClient } from "../types/client.js";
import { GraphqlClient, GraphqlConfig } from "./types.js";

//#region src/graphql/composable.d.ts

/**
 * Creates a client to communicate with Directus GraphQL.
 *
 * @returns A Directus GraphQL client.
 */
declare const graphql: (config?: Partial<GraphqlConfig>) => <Schema>(client: DirectusClient<Schema>) => GraphqlClient<Schema>;
//#endregion
export { graphql };
//# sourceMappingURL=composable.d.ts.map