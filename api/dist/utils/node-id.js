import { nanoid } from "nanoid";

//#region src/utils/node-id.ts
/**
* This process's identity on the bus, stable for its lifetime. Shared by the logs
* stream and the processes report so a log line and the process that emitted it
* carry the same id across the two admin pages.
*/
const nodeId = nanoid(8);

//#endregion
export { nodeId };