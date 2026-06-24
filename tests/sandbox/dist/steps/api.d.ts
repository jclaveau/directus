import "../config.js";
import "../logger.js";
import "../sandbox.js";
import { ChildProcessWithoutNullStreams } from "child_process";

//#region src/steps/api.d.ts
type Api = {
  process: ChildProcessWithoutNullStreams;
  port: number;
  inspector: number;
};
//#endregion
export { Api };