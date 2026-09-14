import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { WorkerMessage } from '../../supervisor/index.js';
import { IN_FLIGHT_REPORT_TOPIC } from '../../types/messages.js';

const watchWorkerMessages = vi.fn();

vi.mock('../../supervisor/index.js', () => {
	return { watchWorkerMessages };
});

const NOW = 1_700_000_000_000;

/** The listener the registry gave the supervisor, so a case can feed it. */
function reporter(): (message: WorkerMessage) => void {
	return watchWorkerMessages.mock.calls[0]![0];
}

function report(pmId: number, inFlight: number): WorkerMessage {
	return {
		data: { topic: IN_FLIGHT_REPORT_TOPIC, inFlight },
		process: { pm_id: pmId },
	};
}

beforeEach(async () => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	watchWorkerMessages.mockClear();

	const { forgetInFlightReports, watchInFlightReports } =
		await import('./in-flight.js');

	forgetInFlightReports();
	watchInFlightReports();
});

afterEach(() => {
	vi.useRealTimers();
});

test('reads back what a worker reported', async () => {
	const { inFlightOf } = await import('./in-flight.js');

	reporter()(report(3, 7));

	expect(inFlightOf(3)).toBe(7);
});

// Every worker of every app the daemon supervises sends over the same channel,
// and the autoscaler owns one of them.
test('ignores a message that is not an in-flight report', async () => {
	const { inFlightOf } = await import('./in-flight.js');

	reporter()({ data: { topic: 'something:else' }, process: { pm_id: 3 } });
	reporter()({ data: 'ready', process: { pm_id: 3 } });

	expect(inFlightOf(3)).toBeNull();
});

// A worker too busy to run its own timer says exactly what an idle one says, so
// a report has to stop counting as one rather than stand until replaced.
test('forgets a report the worker has stopped refreshing', async () => {
	const { inFlightOf } = await import('./in-flight.js');

	reporter()(report(3, 0));

	expect(inFlightOf(3, NOW + 2000)).toBe(0);
	expect(inFlightOf(3, NOW + 9000)).toBeNull();
});

test('has nothing to say about a worker that never reported', async () => {
	const { inFlightOf } = await import('./in-flight.js');

	expect(inFlightOf(99)).toBeNull();
});
