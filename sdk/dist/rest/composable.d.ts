import { DirectusClient } from "../types/client.js";
import { RestClient, RestConfig } from "./types.js";

//#region src/rest/composable.d.ts

/**
 * Creates a client to communicate with the Directus REST API.
 *
 * @returns A Directus REST client.
 */
declare const rest: (config?: Partial<RestConfig>) => <Schema>(client: DirectusClient<Schema>) => RestClient<Schema>;
//#endregion
export { rest };
//# sourceMappingURL=composable.d.ts.map