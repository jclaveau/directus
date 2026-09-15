import { useEnv } from '@directus/env';
import type { Logger } from 'pino';
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { useLogger } from '../logger/index.js';
import { validateBooleanEnv, validateEnv } from './validate-env.js';

vi.mock('@directus/env');

vi.mock('../logger');

let mockLogger: Logger<never>;

beforeAll(() => {
	vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

	vi.mocked(useEnv).mockReturnValue({
		PRESENT_TEST_VARIABLE: 'true',
	});
});

beforeEach(() => {
	mockLogger = {
		error: vi.fn(),
	} as unknown as Logger<never>;

	vi.mocked(useLogger).mockReturnValue(mockLogger);
});

afterEach(() => {
	vi.clearAllMocks();
});

test('should not have any error when key is present', () => {
	validateEnv(['PRESENT_TEST_VARIABLE']);

	expect(mockLogger.error).not.toHaveBeenCalled();
	expect(process.exit).not.toHaveBeenCalled();
});

test('should have error when key is missing', () => {
	validateEnv(['ABSENT_TEST_VARIABLE']);

	expect(mockLogger.error).toHaveBeenCalled();
	expect(process.exit).toHaveBeenCalled();
});

// `toBoolean` reads anything else as `false`, so a deployment that meant
// `TRUE` turns the feature off and gets no line saying it did.
test.each(['TRUE', 'oui', 'yes', 'on', 'true '])(
	'refuses %j, which is read as false',
	(value) => {
		process.env['BOOLEAN_TEST_VARIABLE'] = value;

		validateBooleanEnv(['BOOLEAN_TEST_VARIABLE']);

		expect(mockLogger.error).toHaveBeenCalledWith(
			`"BOOLEAN_TEST_VARIABLE" Environment Variable is ${JSON.stringify(value)}, `
				+ 'which is not a boolean. Use one of true, false, 1, 0.',
		);

		expect(process.exit).toHaveBeenCalledWith(1);
	},
);

// Both spellings of each, and the variable a deployment never set: a check that
// refused one of these would be an outage of its own.
test.each(['true', 'false', '1', '0'])('takes %j', (value) => {
	process.env['BOOLEAN_TEST_VARIABLE'] = value;

	validateBooleanEnv(['BOOLEAN_TEST_VARIABLE']);

	expect(mockLogger.error).not.toHaveBeenCalled();
	expect(process.exit).not.toHaveBeenCalled();
});

test('takes a variable the deployment never set', () => {
	delete process.env['BOOLEAN_TEST_VARIABLE'];

	validateBooleanEnv(['BOOLEAN_TEST_VARIABLE']);

	expect(mockLogger.error).not.toHaveBeenCalled();
	expect(process.exit).not.toHaveBeenCalled();
});
