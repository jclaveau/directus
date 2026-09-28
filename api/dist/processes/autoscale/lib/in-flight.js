import { watchWorkerMessages } from "../../supervisor/lib/client.js";
import "../../supervisor/index.js";
import { IN_FLIGHT_REPORT_TOPIC } from "../../types/messages.js";

//#region src/processes/autoscale/lib/in-flight.ts
/**
* How old a report may be and still be read as what a worker is doing.
*
* Workers report twice a second, so this is several missed reports rather than
* a near miss. Past it the worker counts as having said nothing: a saturated
* worker whose timer is not getting a turn must not read as an idle one.
*/
const REPORT_FRESH_MS = 3e3;
const reports = /* @__PURE__ */ new Map();
/** Collects what the workers say they are serving. */
function watchInFlightReports() {
	watchWorkerMessages(record);
}
function record(message) {
	const report = message.data;
	const pmId = message.process?.pm_id;
	if (pmId === void 0 || typeof report !== "object" || report === null || report.topic !== IN_FLIGHT_REPORT_TOPIC) return;
	const inFlight = report.inFlight;
	if (typeof inFlight === "number") reports.set(pmId, {
		inFlight,
		at: Date.now()
	});
}
/**
* What a worker last said it was serving, or `null` where it has not said it
* recently enough to act on.
*/
function inFlightOf(pmId, now = Date.now()) {
	const report = reports.get(pmId);
	if (report === void 0 || now - report.at > REPORT_FRESH_MS) return null;
	return report.inFlight;
}
/** Forgets every report, for a test that would otherwise read the last one. */
function forgetInFlightReports() {
	reports.clear();
}

//#endregion
export { forgetInFlightReports, inFlightOf, watchInFlightReports };