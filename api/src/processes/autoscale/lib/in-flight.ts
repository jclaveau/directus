import { type WorkerMessage, watchWorkerMessages } from '../../supervisor/index.js';
import { IN_FLIGHT_REPORT_TOPIC } from '../../types/messages.js';

/**
 * How old a report may be and still be read as what a worker is doing.
 *
 * Workers report twice a second, so this is several missed reports rather than
 * a near miss. Past it the worker counts as having said nothing: a saturated
 * worker whose timer is not getting a turn must not read as an idle one.
 */
const REPORT_FRESH_MS = 3000;

const reports = new Map<number, { inFlight: number; at: number }>();

/** Collects what the workers say they are serving. */
export function watchInFlightReports(): void {
	watchWorkerMessages(record);
}

function record(message: WorkerMessage): void {
	const report = message.data;
	const pmId = message.process?.pm_id;

	if (
		pmId === undefined
		|| typeof report !== 'object'
		|| report === null
		|| (report as { topic?: unknown }).topic !== IN_FLIGHT_REPORT_TOPIC
	) {
		return;
	}

	const inFlight = (report as { inFlight?: unknown }).inFlight;

	if (typeof inFlight === 'number') {
		reports.set(pmId, { inFlight, at: Date.now() });
	}
}

/**
 * What a worker last said it was serving, or `null` where it has not said it
 * recently enough to act on.
 */
export function inFlightOf(pmId: number, now: number = Date.now()): number | null {
	const report = reports.get(pmId);

	if (report === undefined || now - report.at > REPORT_FRESH_MS) {
		return null;
	}

	return report.inFlight;
}

/** Forgets every report, for a test that would otherwise read the last one. */
export function forgetInFlightReports(): void {
	reports.clear();
}
