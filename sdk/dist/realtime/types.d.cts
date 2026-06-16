import { WebSocketInterface } from "../types/globals.cjs";
import { CollectionType } from "../types/schema.cjs";
import { ApplyQueryFields } from "../types/output.cjs";
import { Query } from "../types/query.cjs";

//#region src/realtime/types.d.ts
type WebSocketAuthModes = "public" | "handshake" | "strict";
interface WebSocketConfig {
  authMode?: WebSocketAuthModes;
  reconnect?: {
    delay: number;
    retries: number;
  } | false;
  connect?: {
    timeout: number;
  } | false;
  heartbeat?: boolean;
  debug?: boolean;
  url?: string;
}
interface SubscribeOptions<Schema, Collection extends keyof Schema> {
  event?: SubscriptionOptionsEvents;
  query?: Query<Schema, Schema[Collection]>;
  uid?: string;
}
type WebSocketEvents = "open" | "close" | "error" | "message";
type RemoveEventHandler = () => void;
type WebSocketEventHandler = (this: WebSocketInterface, ev: Event | CloseEvent | any) => any;
interface WebSocketClient<Schema> {
  isConnected(): Promise<boolean>;
  connect(): Promise<WebSocketInterface>;
  disconnect(): void;
  onWebSocket(event: "open", callback: (this: WebSocketInterface, ev: Event) => any): RemoveEventHandler;
  onWebSocket(event: "error", callback: (this: WebSocketInterface, ev: Event) => any): RemoveEventHandler;
  onWebSocket(event: "close", callback: (this: WebSocketInterface, ev: CloseEvent) => any): RemoveEventHandler;
  onWebSocket(event: "message", callback: (this: WebSocketInterface, ev: any) => any): RemoveEventHandler;
  onWebSocket(event: WebSocketEvents, callback: WebSocketEventHandler): RemoveEventHandler;
  sendMessage(message: string | Record<string, any>): void;
  subscribe<Collection extends keyof Schema, const Options extends SubscribeOptions<Schema, Collection>>(collection: Collection, options?: Options): Promise<{
    subscription: AsyncGenerator<SubscriptionOutput<Schema, Collection, Options["query"], Fallback<Options["event"], SubscriptionOptionsEvents> | "init">, void, unknown>;
    unsubscribe(): void;
  }>;
}
type ConnectionState = {
  code: "open";
  connection: WebSocketInterface;
  firstMessage: boolean;
} | {
  code: "connecting";
  connection: Promise<WebSocketInterface>;
} | {
  code: "error";
} | {
  code: "closed";
};
type ReconnectState = {
  attempts: number;
  active: false | Promise<WebSocketInterface | void>;
};
type Fallback<Selected, Options> = Selected extends Options ? Selected : Options;
type SubscriptionOptionsEvents = "create" | "update" | "delete";
type SubscriptionEvents = "init" | SubscriptionOptionsEvents;
type SubscriptionOutput<Schema, Collection extends keyof Schema, TQuery extends Query<Schema, Schema[Collection]> | undefined, Events extends SubscriptionEvents, TItem = (TQuery extends Query<Schema, Schema[Collection]> ? ApplyQueryFields<Schema, CollectionType<Schema, Collection>, TQuery["fields"]> : Partial<Schema[Collection]>)> = {
  type: "subscription";
  uid?: string;
} & ({ [Event in Events]: {
  event: Event;
  data: SubscriptionPayload<TItem>[Event];
} }[Events] | {
  event: "error";
  error: {
    code: string;
    message: string;
  };
});
type SubscriptionPayload<Item> = {
  init: Item[];
  create: Item[];
  update: Item[];
  delete: string[] | number[];
};
type WebSocketAuthError = {
  type: "auth";
  status: "error";
  error: {
    code: string;
    message: string;
  };
};
//#endregion
export { ConnectionState, ReconnectState, RemoveEventHandler, SubscribeOptions, SubscriptionEvents, SubscriptionOptionsEvents, SubscriptionOutput, SubscriptionPayload, WebSocketAuthError, WebSocketAuthModes, WebSocketClient, WebSocketConfig, WebSocketEventHandler, WebSocketEvents };
//# sourceMappingURL=types.d.cts.map