import { ClientOptions, DirectusClient } from "./types/client.js";

//#region src/client.d.ts

/**
 * Creates a client to communicate with a Directus app.
 *
 * @param url The URL to the Directus app.
 * @param options The client options. Defaults to the standard implementation of `globals`.
 *
 * @returns A Directus client.
 */
declare const createDirectus: <Schema = any>(url: string, options?: ClientOptions) => DirectusClient<Schema>;
//#endregion
export { createDirectus };
//# sourceMappingURL=client.d.ts.map