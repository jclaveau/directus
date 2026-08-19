import { oneLine } from '@directus/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLogger } from '../logger/index.js';
import { useMetrics } from '../metrics/index.js';
import { reportUnhandledRejection } from './report-unhandled-rejection.js';

vi.mock('../logger/index.js');
vi.mock('../metrics/index.js');

const error = vi.fn();
const inc = vi.fn();

beforeEach(() => {
	vi.mocked(useLogger).mockReturnValue({ error } as any);

	vi.mocked(useMetrics).mockReturnValue({
		getUnhandledRejectionMetric: () => ({ inc }),
	} as any);
});

afterEach(() => {
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

	it('reports even when metrics are off', () => {
		vi.mocked(useMetrics).mockReturnValue(undefined);

		expect(() => reportUnhandledRejection(new Error('boom'))).not.toThrow();
		expect(error).toHaveBeenCalledOnce();
	});
});
