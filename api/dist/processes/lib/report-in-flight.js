import { IN_FLIGHT_REPORT_TOPIC } from "../types/messages.js";

//#region src/processes/lib/report-in-flight.ts
/**
* How often a worker says how many requests it is serving.
*
* The autoscaler decides once a second, and a report it has to wait for is a
* report it decides without. Half that, so every tick has one that arrived
* since the last.
*/
const REPORT_INTERVAL_MS = 500;
let inFlight = 0;
let reporting = null;
/**
* Tells the supervisor what this worker is serving, over pm2's own channel.
*
* Not the bus: the autoscaler is built to keep scaling through a Redis outage,
* and a signal it reads while choosing which worker to stop cannot be one that
* disappears with Redis. pm2 forwards a worker's `process.send` to its daemon,
* which re-emits it on the bus the autoscaler listens to, and that path is the
* supervisor itself — if it is down there is nothing to scale.
*
* Only the count travels. What the requests are is the reporting side of the
* processes module, which does ride the bus; this exists to answer one
* question, asked every second, about a worker that may be about to be stopped.
*/
function reportInFlightRequests(server) {
	const send = process.send?.bind(process);
	if (send === void 0) return;
	server.on("request", (_request, response) => {
		inFlight += 1;
		response.once("close", () => {
			inFlight -= 1;
		});
	});
	reporting = setInterval(() => {
		send({
			type: "process:msg",
			data: {
				topic: IN_FLIGHT_REPORT_TOPIC,
				inFlight
			}
		});
	}, REPORT_INTERVAL_MS);
	reporting.unref();
}
/** Stops the reports, for a test that would otherwise leave the timer behind. */
function stopReportingInFlightRequests() {
	if (reporting !== null) {
		clearInterval(reporting);
		reporting = null;
	}
	inFlight = 0;
}

//#endregion
export { reportInFlightRequests, stopReportingInFlightRequests };