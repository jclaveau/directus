import { DirectusClient } from "../types/client.cjs";
import { AuthenticationClient, AuthenticationConfig, AuthenticationMode } from "./types.cjs";

//#region src/auth/composable.d.ts

/**
 * Creates a client to authenticate with Directus.
 *
 * @param mode AuthenticationMode
 * @param config The optional configuration.
 *
 * @returns A Directus authentication client.
 */
declare const authentication: (mode?: AuthenticationMode, config?: Partial<AuthenticationConfig>) => <Schema>(client: DirectusClient<Schema>) => AuthenticationClient<Schema>;
//#endregion
export { authentication };
//# sourceMappingURL=composable.d.cts.map