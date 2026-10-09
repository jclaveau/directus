//#region src/processes/types/messages.ts
/** The bus channel a collector asks every node to describe itself on. */
const PROCESSES_QUERY_CHANNEL = "processes:query";
/** The bus channel every node answers a query on. */
const PROCESSES_REPORT_CHANNEL = "processes:report";
/**
* Marks a worker's in-flight report on pm2's channel.
*
* pm2 gives every worker message the same bus event, so the listener has to
* recognise its own by what is inside them.
*/
const IN_FLIGHT_REPORT_TOPIC = "processes:in-flight";

//#endregion
export { IN_FLIGHT_REPORT_TOPIC, PROCESSES_QUERY_CHANNEL, PROCESSES_REPORT_CHANNEL };