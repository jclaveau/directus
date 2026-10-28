import { ConsoleInterface, FetchInterface, UrlInterface, WebSocketConstructor } from "./globals.js";

//#region src/types/client.d.ts

/**
 * empty directus client
 */
interface DirectusClient<Schema> {
  url: URL;
  globals: ClientGlobals;
  with: <Extension extends object>(createExtension: (client: DirectusClient<Schema>) => Extension) => this & Extension;
}
/**
 * All used globals for the client
 */
type ClientGlobals = {
  fetch: FetchInterface;
  WebSocket: WebSocketConstructor;
  URL: UrlInterface;
  logger: ConsoleInterface;
};
/**
 * Available options on the client
 */
type ClientOptions = {
  globals?: Partial<ClientGlobals>;
};
//#endregion
export { ClientGlobals, ClientOptions, DirectusClient };
//# sourceMappingURL=client.d.ts.map