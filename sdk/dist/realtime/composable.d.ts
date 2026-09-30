import { DirectusClient } from "../types/client.js";
import { WebSocketClient, WebSocketConfig } from "./types.js";

//#region src/realtime/composable.d.ts

/**
 * Creates a client to communicate with a Directus REST WebSocket.
 *
 * @param config The optional configuration.
 *
 * @returns A Directus realtime client.
 */
declare function realtime(config?: WebSocketConfig): <Schema>(client: DirectusClient<Schema>) => WebSocketClient<Schema>;
//#endregion
export { realtime };
//# sourceMappingURL=composable.d.ts.map