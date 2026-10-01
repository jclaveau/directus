import type { Server } from 'node:http';
import { IN_FLIGHT_REPORT_TOPIC, type InFlightReport } from '../types/messages.js';

/**
 * How often a worker says how many requests it is serving.
 *
 * The autoscaler decides once a second, and a report it has to wait for is a
 * report it decides without. Half that, so every tick has one that arrived
 * since the last.
 */
const REPORT_INTERVAL_MS = 500;

let inFlight = 0;
let reporting: NodeJS.Timeout | null = null;

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
export function reportInFlightRequests(server: Server): void {
	const send = process.send?.bind(process);

	if (send === undefined) {
		return;
	}

	server.on('request', (_request, response) => {
		inFlight += 1;

		// `close` fires for a response that finished and for one whose socket
		// went away, and fires once either way, so a client that hangs up mid
		// request does not leave the worker looking busy forever.
		response.once('close', () => {
			inFlight -= 1;
		});
	});

	reporting = setInterval(() => {
		const report: InFlightReport = {
			topic: IN_FLIGHT_REPORT_TOPIC,
			inFlight,
		};

		// pm2 reads `type` to decide which bus event to re-emit and forwards
		// `data` verbatim; nothing else of the message survives the hop, so the
		// topic travels inside it.
		send({ type: 'process:msg', data: report });
	}, REPORT_INTERVAL_MS);

	reporting.unref();
}

/** Stops the reports, for a test that would otherwise leave the timer behind. */
export function stopReportingInFlightRequests(): void {
	if (reporting !== null) {
		clearInterval(reporting);
		reporting = null;
	}

	inFlight = 0;
}
