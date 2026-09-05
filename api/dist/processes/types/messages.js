//#region src/processes/types/messages.ts
/** The bus channel a collector asks every node to describe itself on. */
const PROCESSES_QUERY_CHANNEL = "processes:query";
/** The bus channel every node answers a query on. */
const PROCESSES_REPORT_CHANNEL = "processes:report";

//#endregion
export { PROCESSES_QUERY_CHANNEL, PROCESSES_REPORT_CHANNEL };