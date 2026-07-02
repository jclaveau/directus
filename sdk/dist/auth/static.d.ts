import { DirectusClient } from "../types/client.js";
import { StaticTokenClient } from "./types.js";

//#region src/auth/static.d.ts

/**
 * Creates a client to authenticate with Directus using a static token.
 *
 * @param token static token.
 *
 * @returns A Directus static token client.
 */
declare const staticToken: (access_token: string) => <Schema>(_client: DirectusClient<Schema>) => StaticTokenClient<Schema>;
//#endregion
export { staticToken };
//# sourceMappingURL=static.d.ts.map