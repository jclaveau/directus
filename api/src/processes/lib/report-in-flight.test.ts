import { EventEmitter } from 'node:events';
import type { Server } from 'node:http';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { IN_FLIGHT_REPORT_TOPIC } from '../types/messages.js';

const send = vi.fn();

/** A server and a response, as the reporter reads them. */
function serving(): { server: Server; open: () => EventEmitter } {
	const server = new EventEmitter() as unknown as Server;

	return {
		server,
		open: () => {
			const response = new EventEmitter();
			server.emit('request', {}, response);

			return response;
		},
	};
}

function reported(): number[] {
	return send.mock.calls.map((call) => call[0].data.inFlight);
}

beforeEach(async () => {
	vi.useFakeTimers();
	send.mockClear();
	process.send = send;

	const { stopReportingInFlightRequests } = await import('./report-in-flight.js');

	stopReportingInFlightRequests();
});

afterEach(async () => {
	const { stopReportingInFlightRequests } = await import('./report-in-flight.js');

	stopReportingInFlightRequests();
	vi.useRealTimers();
	delete process.send;
});

test('reports the requests the worker has open', async () => {
	const { reportInFlightRequests } = await import('./report-in-flight.js');
	const { server, open } = serving();

	reportInFlightRequests(server);
	open();
	open();
	await vi.advanceTimersByTimeAsync(500);

	expect(reported()).toEqual([2]);

	expect(send).toHaveBeenCalledWith({
		type: 'process:msg',
		data: { topic: IN_FLIGHT_REPORT_TOPIC, inFlight: 2 },
	});
});

// `close` fires for a response that finished and for one whose socket went
// away, so a client that hangs up mid request does not leave the worker
// looking busy for as long as it runs.
test('counts a request out however it ended', async () => {
	const { reportInFlightRequests } = await import('./report-in-flight.js');
	const { server, open } = serving();

	reportInFlightRequests(server);
	const finished = open();
	const abandoned = open();

	finished.emit('close');
	abandoned.emit('close');
	await vi.advanceTimersByTimeAsync(500);

	expect(reported()).toEqual([0]);
});

// The report exists for the supervisor, and a process no supervisor started
// has nobody to send it to.
test('says nothing when no supervisor is listening', async () => {
	delete process.send;

	const { reportInFlightRequests } = await import('./report-in-flight.js');
	const { server, open } = serving();

	reportInFlightRequests(server);
	open();
	await vi.advanceTimersByTimeAsync(2000);

	expect(send).not.toHaveBeenCalled();
});
