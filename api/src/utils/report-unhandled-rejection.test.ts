import { oneLine } from '@directus/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLogger } from '../logger/index.js';
import { useMetrics } from '../metrics/index.js';
import {
	guardUnhandledRejections,
	reportUnhandledRejection,
} from './report-unhandled-rejection.js';

vi.mock('../logger/index.js');
vi.mock('../metrics/index.js');

const error = vi.fn();
const inc = vi.fn();

// The throttle is module state, so each case starts far enough after the last that
// nothing it logs is mistaken for a repeat of what the case before it logged.
let clock = Date.now();

beforeEach(() => {
	clock += 3_600_000;
	vi.useFakeTimers();
	vi.setSystemTime(clock);

	vi.mocked(useLogger).mockReturnValue({ error } as any);

	vi.mocked(useMetrics).mockReturnValue({
		getUnhandledRejectionMetric: () => ({ inc }),
	} as any);
});

afterEach(() => {
	vi.useRealTimers();
	vi.clearAllMocks();
});

describe('reportUnhandledRejection', () => {
	it('logs the rejection and counts it', () => {
		const reason = new Error('boom');

		reportUnhandledRejection(reason);

		expect(error).toHaveBeenCalledWith(
			reason,
			'Unhandled promise rejection: Error: boom',
		);

		expect(inc).toHaveBeenCalledOnce();
	});

	it(oneLine`
		wraps a rejection that is not an Error — pino reads a primitive first argument
		as the message and drops the second, so the line would lose the one word that
		says what it is
	`, () => {
		reportUnhandledRejection('boom');

		expect(error).toHaveBeenCalledWith(
			{ reason: 'boom' },
			'Unhandled promise rejection: boom',
		);
	});

	it(oneLine`
		logs one line per failure per window — a dependency that is down rejects once
		per command asked of it, so the volume follows the traffic and not the failure
	`, () => {
		reportUnhandledRejection(new Error('refused'));
		reportUnhandledRejection(new Error('refused'));

		expect(error).toHaveBeenCalledOnce();
		expect(inc).toHaveBeenCalledTimes(2);
	});

	it('counts what the window swallowed into the line that ends it', () => {
		reportUnhandledRejection(new Error('flushed'));
		reportUnhandledRejection(new Error('flushed'));
		reportUnhandledRejection(new Error('flushed'));

		vi.setSystemTime(clock + 60_000);
		reportUnhandledRejection(new Error('flushed'));

		expect(error).toHaveBeenLastCalledWith(
			expect.any(Error),
			'Unhandled promise rejection: Error: flushed (2 more since the last)',
		);
	});

	it('throttles each failure on its own', () => {
		reportUnhandledRejection(new Error('socket closed'));
		reportUnhandledRejection(new Error('auth failed'));

		expect(error).toHaveBeenCalledTimes(2);
	});

	it('reports even when metrics are off', () => {
		vi.mocked(useMetrics).mockReturnValue(undefined);

		expect(() => reportUnhandledRejection(new Error('boom'))).not.toThrow();
		expect(error).toHaveBeenCalledOnce();
	});
});

describe('guardUnhandledRejections', () => {
	afterEach(() => {
		// The listener outlives the case: the process running these is the one it
		// would be installed on.
		process.removeListener('unhandledRejection', reportUnhandledRejection);
	});

	it('answers a rejection nothing awaited', () => {
		guardUnhandledRejections();

		expect(process.listeners('unhandledRejection'))
			.toContain(reportUnhandledRejection);
	});

	// Every entry point takes it, and one process can enter through more than one
	// of them. A second listener would count the same outage twice, and the count
	// is what says how much of one this process swallowed.
	it('leaves one listener however often it is taken', () => {
		guardUnhandledRejections();
		guardUnhandledRejections();

		const taken = process
			.listeners('unhandledRejection')
			.filter((listener) => listener === reportUnhandledRejection);

		expect(taken).toHaveLength(1);
	});
});
