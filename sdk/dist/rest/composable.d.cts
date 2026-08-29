import { DirectusClient } from "../types/client.cjs";
import { RestClient, RestConfig } from "./types.cjs";

//#region src/rest/composable.d.ts

/**
 * Creates a client to communicate with the Directus REST API.
 *
 * @returns A Directus REST client.
 */
declare const rest: (config?: Partial<RestConfig>) => <Schema>(client: DirectusClient<Schema>) => RestClient<Schema>;
//#endregion
export { rest };
//# sourceMappingURL=composable.d.cts.map