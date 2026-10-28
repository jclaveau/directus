import { WebSocketInterface } from "../../types/globals.cjs";

//#region src/realtime/utils/message-callback.d.ts

/**
 * Wait for a websocket response
 *
 * @param socket WebSocket
 * @param number timeout
 *
 * @returns Incoming message object
 */
declare const messageCallback: (socket: WebSocketInterface, timeout?: number) => Promise<Record<string, any> | MessageEvent<string> | undefined>;
//#endregion
export { messageCallback };
//# sourceMappingURL=message-callback.d.cts.map