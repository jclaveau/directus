import "./config.js";
import "./sandbox.js";
import Stream from "stream";

//#region src/logger.d.ts
type Logger = {
  addGroup: (group: string) => Logger;
  fatal: (msg: string) => void;
  error: (msg: string) => void;
  warn: (msg: string) => void;
  info: (msg: string) => void;
  debug: (msg: string) => void;
  pipe: (stream: Stream.Readable | null, type?: LogLevel) => void;
  onLog: (listener: LogListener) => void;
};
declare const logLevels: readonly ["fatal", "error", "warn", "info", "debug", "trace"];
type LogLevel = (typeof logLevels)[number];
type LogListener = (message: string, type: LogLevel, groups: string[]) => void;
//#endregion
export { Logger };