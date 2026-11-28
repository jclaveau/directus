//#region src/types/globals.d.ts
type FetchInterface = (input: string | any, init?: RequestInit | any) => Promise<unknown>;
type UrlInterface = typeof URL;
/** While the standard says 'string | URL' for the 'url' parameter, some implementations (e.g. React Native) only accept 'string' */
type WebSocketConstructor = {
  new (url: string, protocols?: string | string[]): WebSocketInterface;
};
type WebSocketInterface = {
  readonly readyState: number;
  addEventListener(type: string, listener: (this: WebSocketInterface, ev: any) => any): void;
  removeEventListener(type: string, listener: (this: WebSocketInterface, ev: any) => any): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
};
type LogLevels = 'log' | 'info' | 'warn' | 'error';
type ConsoleInterface = { [level in LogLevels]: (...args: any) => any };
//#endregion
export { ConsoleInterface, FetchInterface, LogLevels, UrlInterface, WebSocketConstructor, WebSocketInterface };
//# sourceMappingURL=globals.d.ts.map